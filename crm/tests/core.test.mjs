import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "whatsbot-crm-core-"));
process.env.CRM_TURSO_DATABASE_URL = `file:${path.join(dir, "crm.db")}`;
process.env.CRM_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.CRM_CRYPTO_KEY = crypto.randomBytes(32).toString("base64");
process.env.META_GRAPH_VERSION = "v25.0";

const { aplicarMigraciones } = await import("../lib/migrations.js");
const {
  autenticarBot,
  cargarContextoUsuario,
  crearBotApiKey,
  crearNegocio,
  crearUsuario,
  estadoAdministracion,
  getConversacionAutorizada,
  guardarCanal,
  guardarMembresia,
  ingestarMensaje,
  listarConversaciones,
} = await import("../lib/data.js");
const { ejecutar, fila, filas } = await import("../lib/client.js");
const { cifrarSecreto, descifrarSecreto, generarApiKey } = await import("../lib/crypto.js");
const { crearSesion, cookieSesion, contexto, hashPassword } = await import("../lib/auth.js");
const { resolverFeatures } = await import("../lib/features.js");
const ingestHandler = (await import("../server/ingest/mensaje.js")).default;
const conversacionesHandler = (await import("../server/backoffice/conversaciones.js")).default;
const asignarHandler = (await import("../server/backoffice/asignar.js")).default;
const etiquetasHandler = (await import("../server/backoffice/etiquetas.js")).default;
const adminEstadoHandler = (await import("../server/admin/estado.js")).default;

await aplicarMigraciones();

function resMock() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function llamar(handler, usuarioId, { method = "GET", query = {}, body = {} } = {}) {
  const req = {
    method,
    query,
    body,
    headers: usuarioId
      ? { cookie: cookieSesion(crearSesion(usuarioId)).split(";")[0] }
      : {},
  };
  const res = resMock();
  await handler(req, res);
  return res;
}

test("las migraciones son repetibles y siembran solo el plan full", async () => {
  assert.deepEqual(await aplicarMigraciones(), []);
  const planes = await filas('SELECT DISTINCT tier FROM "PlanFeature"');
  assert.deepEqual(planes.map((p) => p.tier), ["full"]);
  const max = await fila('SELECT valor FROM "PlanFeature" WHERE tier = ? AND feature = ?', ["full", "maxAgentes"]);
  assert.equal(max.valor, "unlimited");
});

test("la resolución tipada respeta defaults, plan y override", () => {
  assert.deepEqual(
    resolverFeatures(
      [
        { feature: "etiquetas", valor: "true" },
        { feature: "maxAgentes", valor: "3" },
      ],
      [
        { feature: "etiquetas", valor: "false" },
        { feature: "maxAgentes", valor: "unlimited" },
      ]
    ),
    {
      etiquetas: false,
      notas: false,
      valoracion: false,
      atajos: false,
      gestionUsuarios: false,
      maxAgentes: null,
    }
  );
});

test("el primer superadmin puede administrar antes de crear un negocio", async () => {
  const usuarioId = await crearUsuario({
    usuario: "super-inicial",
    nombre: "Super inicial",
    passwordHash: hashPassword("password-seguro"),
    esSuperAdmin: true,
  });
  const contextoInicial = await cargarContextoUsuario(usuarioId);
  assert.equal(contextoInicial.usuario.esSuperAdmin, true);
  assert.deepEqual(contextoInicial.negocios, []);
  const estado = await estadoAdministracion([], true);
  assert.deepEqual(estado.negocios, []);
  assert.ok(estado.usuarios.some((usuario) => usuario.id === usuarioId));
});

test("AES-GCM cifra tokens y una clave incorrecta no puede descifrarlos", () => {
  const original = process.env.CRM_CRYPTO_KEY;
  const cifrado = cifrarSecreto("token-meta-super-secreto");
  assert.doesNotMatch(cifrado, /token-meta/);
  assert.equal(descifrarSecreto(cifrado), "token-meta-super-secreto");
  process.env.CRM_CRYPTO_KEY = crypto.randomBytes(32).toString("base64");
  assert.throws(() => descifrarSecreto(cifrado));
  process.env.CRM_CRYPTO_KEY = original;
});

test("la ingesta deduce el tenant de la key, deduplica y separa el mismo número", async () => {
  const negocioA = await crearNegocio({ clave: "alpha", nombre: "Alpha" });
  const negocioB = await crearNegocio({ clave: "beta", nombre: "Beta" });
  await guardarCanal({
    negocioId: negocioA,
    phoneNumberId: "phone-alpha",
    nombre: "Alpha",
    tokenCifrado: cifrarSecreto("token-a"),
  });
  await guardarCanal({
    negocioId: negocioB,
    phoneNumberId: "phone-beta",
    nombre: "Beta",
    tokenCifrado: cifrarSecreto("token-b"),
  });
  const keyA = generarApiKey();
  const keyB = generarApiKey();
  await crearBotApiKey({ negocioId: negocioA, nombre: "Bot A", keyHash: keyA.hash, keySuffix: keyA.suffix });
  await crearBotApiKey({ negocioId: negocioB, nombre: "Bot B", keyHash: keyB.hash, keySuffix: keyB.suffix });

  const req = {
    method: "POST",
    headers: { authorization: `Bearer ${keyA.key}` },
    body: {
      numero: "5493815550000",
      phoneNumberId: "phone-alpha",
      rol: "user",
      contenido: "Hola Alpha",
      idExterno: "wamid.1",
      negocioId: negocioB,
    },
  };
  const res1 = resMock();
  await ingestHandler(req, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.payload.estado, "bot");
  assert.deepEqual(res1.payload.historial, [{ role: "user", content: "Hola Alpha" }]);

  const resDuplicada = resMock();
  await ingestHandler(req, resDuplicada);
  assert.equal(resDuplicada.statusCode, 200);
  assert.equal(resDuplicada.payload.duplicado, true);
  const mensajesA = await fila('SELECT COUNT(*) AS cantidad FROM "Mensaje" WHERE negocioId = ?', [negocioA]);
  assert.equal(Number(mensajesA.cantidad), 1);

  await ingestarMensaje(negocioB, {
    numero: "5493815550000",
    phoneNumberId: "phone-beta",
    rol: "user",
    contenido: "Hola Beta",
    idExterno: "wamid.1",
  });
  const conversaciones = await filas('SELECT id, negocioId, numero FROM "Conversacion" WHERE numero = ?', ["5493815550000"]);
  assert.equal(conversaciones.length, 2);
  assert.deepEqual(new Set(conversaciones.map((c) => Number(c.negocioId))), new Set([negocioA, negocioB]));
  assert.ok(await autenticarBot(keyA.key));
  assert.equal(await autenticarBot("wbk_invalida"), null);
});

test("constraints compuestos y atajos parciales impiden cruces y duplicados", async () => {
  const alpha = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["alpha"])).id);
  const beta = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["beta"])).id);
  const convAlpha = await fila('SELECT id FROM "Conversacion" WHERE negocioId = ? LIMIT 1', [alpha]);
  await assert.rejects(
    () =>
      ejecutar(
        `INSERT INTO "Mensaje" (conversacionId, negocioId, rol, contenido)
         VALUES (?, ?, 'user', 'cruce')`,
        [convAlpha.id, beta]
      ),
    /FOREIGN KEY|constraint/i
  );

  await ejecutar('INSERT INTO "Atajo" (negocioId, clave, texto) VALUES (NULL, ?, ?)', ["global", "Uno"]);
  await assert.rejects(
    () => ejecutar('INSERT INTO "Atajo" (negocioId, clave, texto) VALUES (NULL, ?, ?)', ["global", "Dos"]),
    /UNIQUE|constraint/i
  );
  await ejecutar('INSERT INTO "Atajo" (negocioId, clave, texto) VALUES (?, ?, ?)', [alpha, "horario", "Alpha"]);
  await ejecutar('INSERT INTO "Atajo" (negocioId, clave, texto) VALUES (?, ?, ?)', [beta, "horario", "Beta"]);
  await assert.rejects(
    () => ejecutar('INSERT INTO "Atajo" (negocioId, clave, texto) VALUES (?, ?, ?)', [alpha, "horario", "Duplicado"]),
    /UNIQUE|constraint/i
  );
});

test("matriz agente, admin y superadmin aísla tenants y aplica features", async () => {
  const alpha = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["alpha"])).id);
  const beta = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["beta"])).id);
  const agenteId = await crearUsuario({
    usuario: "agente-matriz",
    nombre: "Agente matriz",
    passwordHash: hashPassword("password-seguro"),
  });
  const adminId = await crearUsuario({
    usuario: "admin-matriz",
    nombre: "Admin matriz",
    passwordHash: hashPassword("password-seguro"),
  });
  const superId = await crearUsuario({
    usuario: "super-matriz",
    nombre: "Super matriz",
    passwordHash: hashPassword("password-seguro"),
    esSuperAdmin: true,
  });
  await guardarMembresia(agenteId, alpha, "agente");
  await guardarMembresia(adminId, alpha, "admin");

  const agenteAlpha = await llamar(conversacionesHandler, agenteId, { query: { negocioId: alpha } });
  assert.equal(agenteAlpha.statusCode, 200);
  assert.ok(agenteAlpha.payload.conversaciones.every((conv) => conv.negocioId === alpha));
  assert.equal(
    (await llamar(conversacionesHandler, agenteId, { query: { negocioId: beta } })).statusCode,
    403
  );
  const superTodos = await llamar(conversacionesHandler, superId);
  assert.equal(superTodos.statusCode, 200);
  assert.deepEqual(
    new Set(superTodos.payload.conversaciones.map((conv) => conv.negocioId)),
    new Set([alpha, beta])
  );

  const conversacionId = Number(agenteAlpha.payload.conversaciones[0].id);
  assert.equal(
    (
      await llamar(asignarHandler, agenteId, {
        method: "POST",
        body: { conversacionId, usuarioId: agenteId },
      })
    ).statusCode,
    200
  );
  assert.equal(
    (
      await llamar(asignarHandler, adminId, {
        method: "POST",
        body: { conversacionId, usuarioId: adminId },
      })
    ).statusCode,
    200
  );
  assert.equal(
    (
      await llamar(asignarHandler, agenteId, {
        method: "POST",
        body: { conversacionId, usuarioId: agenteId },
      })
    ).statusCode,
    403
  );

  const estadoSuper = await llamar(adminEstadoHandler, superId);
  assert.equal(estadoSuper.statusCode, 200);
  const estadoSerializado = JSON.stringify(estadoSuper.payload);
  assert.doesNotMatch(estadoSerializado, /tokenCifrado|token-a|token-b/);
  assert.ok(estadoSuper.payload.canales.every((canal) => "tieneToken" in canal));

  await ejecutar(
    `INSERT INTO "NegocioFeature" (negocioId, feature, valor)
     VALUES (?, 'etiquetas', 'false')
     ON CONFLICT(negocioId, feature) DO UPDATE SET valor = excluded.valor`,
    [alpha]
  );
  assert.equal(
    (
      await llamar(etiquetasHandler, agenteId, {
        method: "POST",
        body: { conversacionId, etiquetas: ["vip"] },
      })
    ).statusCode,
    403
  );
  await ejecutar('DELETE FROM "NegocioFeature" WHERE negocioId = ? AND feature = ?', [alpha, "etiquetas"]);

  await ejecutar(
    `INSERT INTO "NegocioFeature" (negocioId, feature, valor)
     VALUES (?, 'gestionUsuarios', 'false')
     ON CONFLICT(negocioId, feature) DO UPDATE SET valor = excluded.valor`,
    [alpha]
  );
  assert.equal((await llamar(adminEstadoHandler, adminId)).statusCode, 403);
  await ejecutar('DELETE FROM "NegocioFeature" WHERE negocioId = ? AND feature = ?', [alpha, "gestionUsuarios"]);

  await ejecutar('DELETE FROM "UsuarioNegocio" WHERE usuarioId = ? AND negocioId = ?', [agenteId, alpha]);
  assert.equal(
    (await llamar(conversacionesHandler, agenteId, { query: { negocioId: alpha } })).statusCode,
    403
  );
});

test("la derivación puede guardarse atómicamente con la respuesta", async () => {
  const negocio = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["alpha"])).id);
  const resultado = await ingestarMensaje(negocio, {
    numero: "5493815550000",
    phoneNumberId: "phone-alpha",
    rol: "assistant",
    contenido: "Te paso con una persona.",
    idExterno: "wamid.2",
    derivar: true,
  });
  assert.equal(resultado.estado, "humano");
  const conv = await getConversacionAutorizada(resultado.conversacionId, [negocio]);
  assert.equal(conv.estado, "humano");
});

test("sesión mínima recarga membresías y la desactivación corta acceso inmediatamente", async () => {
  const negocio = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["alpha"])).id);
  const usuarioId = await crearUsuario({
    usuario: "agente-core",
    nombre: "Agente Core",
    passwordHash: hashPassword("password-seguro"),
  });
  await guardarMembresia(usuarioId, negocio, "agente");
  const token = crearSesion(usuarioId);
  const req = { headers: { cookie: cookieSesion(token).split(";")[0] } };
  const ctx = await contexto(req);
  assert.equal(ctx.usuario.id, usuarioId);
  assert.deepEqual(ctx.negocios.map((n) => n.id), [negocio]);
  assert.equal(ctx.negocios[0].features.etiquetas, true);

  await ejecutar('UPDATE "Usuario" SET activo = 0 WHERE id = ?', [usuarioId]);
  assert.equal(await contexto(req), null);
});

test("los helpers de bandeja exigen y respetan un scope explícito", async () => {
  const alpha = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["alpha"])).id);
  const beta = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["beta"])).id);
  const soloAlpha = await listarConversaciones([alpha]);
  assert.ok(soloAlpha.length >= 1);
  assert.ok(soloAlpha.every((c) => c.negocioId === alpha));
  await assert.rejects(() => listarConversaciones([]), /al menos un valor/);
  const todas = await listarConversaciones([alpha, beta]);
  assert.ok(todas.some((c) => c.negocioId === beta));
});

test("las claves revocadas dejan de autenticar", async () => {
  const negocio = Number((await fila('SELECT id FROM "Negocio" WHERE clave = ?', ["alpha"])).id);
  const key = generarApiKey();
  const id = await crearBotApiKey({ negocioId: negocio, nombre: "Rotación", keyHash: key.hash, keySuffix: key.suffix });
  assert.ok(await autenticarBot(key.key));
  await ejecutar('UPDATE "BotApiKey" SET activo = 0, revokedAt = datetime(\'now\') WHERE id = ?', [id]);
  assert.equal(await autenticarBot(key.key), null);
});

test.after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
