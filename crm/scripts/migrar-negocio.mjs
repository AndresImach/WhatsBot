import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { cargarEnv, argumentos } from "./_env.mjs";

cargarEnv();
const args = argumentos();
const clave = String(args.negocio || "").trim().toLowerCase();
const aplicar = args.apply === true;
if (!clave) {
  console.error("Uso: npm run migrate:legacy -- --negocio <clave> [--mapping usuarios.json] [--apply]");
  process.exit(1);
}

const sourceUrl = process.env.SOURCE_TURSO_DATABASE_URL || "";
const targetUrl = process.env.CRM_TURSO_DATABASE_URL || "";
if (!sourceUrl || !targetUrl) throw new Error("Faltan SOURCE_TURSO_DATABASE_URL y/o CRM_TURSO_DATABASE_URL.");

const source = createClient({ url: sourceUrl, authToken: process.env.SOURCE_TURSO_AUTH_TOKEN || undefined });
const target = createClient({ url: targetUrl, authToken: process.env.CRM_TURSO_AUTH_TOKEN || undefined });
const mapping = args.mapping ? JSON.parse(await fs.readFile(String(args.mapping), "utf8")) : {};
const origen = `${new URL(sourceUrl.replace(/^libsql:/, "https:")).hostname}:${clave}`;

const rows = async (client, sql, values = []) =>
  (await client.execute({ sql, args: values })).rows.map((row) => ({ ...row }));
const one = async (client, sql, values = []) => (await rows(client, sql, values))[0] || null;
const exists = async (client, table) =>
  !!(await one(client, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]));

for (const table of ["Conversacion", "Mensaje", "Nota", "Agente", "Atajo"]) {
  if (!(await exists(source, table))) throw new Error(`La base origen no tiene la tabla ${table}.`);
}
const negocio = await one(target, 'SELECT id, clave, nombre FROM "Negocio" WHERE clave = ? LIMIT 1', [clave]);
if (!negocio) throw new Error(`Primero creá el negocio "${clave}" desde el panel superadmin.`);
const negocioId = Number(negocio.id);

const [conversaciones, mensajes, notas, agentes, atajos, canales] = await Promise.all([
  rows(source, 'SELECT * FROM "Conversacion" ORDER BY numero'),
  rows(source, 'SELECT * FROM "Mensaje" ORDER BY id'),
  rows(source, 'SELECT * FROM "Nota" ORDER BY id'),
  rows(source, 'SELECT * FROM "Agente" ORDER BY id'),
  rows(source, 'SELECT * FROM "Atajo" ORDER BY id'),
  rows(target, 'SELECT id, phoneNumberId FROM "Canal" WHERE negocioId = ?', [negocioId]),
]);
const canalPorPhone = new Map(canales.map((c) => [String(c.phoneNumberId), Number(c.id)]));
const canalesFaltantes = [...new Set(conversaciones.map((c) => c.canal).filter(Boolean).filter((id) => !canalPorPhone.has(String(id))))];

const conflictos = [];
for (const agente of agentes) {
  const usuario = String(mapping[agente.usuario] || agente.usuario).trim().toLowerCase();
  const existente = await one(target, 'SELECT id, passwordHash FROM "Usuario" WHERE usuario = ? LIMIT 1', [usuario]);
  if (existente && existente.passwordHash !== agente.passwordHash) conflictos.push({ origen: agente.usuario, destino: usuario });
}

const resumen = {
  modo: aplicar ? "apply" : "dry-run",
  origen,
  negocio: { id: negocioId, clave: negocio.clave, nombre: negocio.nombre },
  filas: {
    conversaciones: conversaciones.length,
    mensajes: mensajes.length,
    notas: notas.length,
    agentes: agentes.length,
    atajos: atajos.length,
  },
  canalesFaltantes,
  conflictosUsuarios: conflictos,
};
console.log(JSON.stringify(resumen, null, 2));
if (conflictos.length) throw new Error("Hay usernames incompatibles. Resolvelos con --mapping antes de aplicar.");
if (aplicar && canalesFaltantes.length) {
  throw new Error("Faltan canales en el CRM. Provisioná todos los Phone Number ID antes de aplicar.");
}
if (!aplicar) {
  console.log("Dry-run completo. Volvé a ejecutar con --apply para escribir.");
  process.exit(0);
}

const usuarioDestinoPorOrigen = new Map();
for (const agente of agentes) {
  const usuario = String(mapping[agente.usuario] || agente.usuario).trim().toLowerCase();
  let destino = await one(target, 'SELECT id FROM "Usuario" WHERE usuario = ? LIMIT 1', [usuario]);
  if (!destino) {
    destino = (
      await target.execute({
        sql:
          `INSERT INTO "Usuario" (usuario, passwordHash, nombre, activo)
           VALUES (?, ?, ?, ?) RETURNING id`,
        args: [usuario, agente.passwordHash, agente.nombre || usuario, agente.activo ? 1 : 0],
      })
    ).rows[0];
  }
  const usuarioId = Number(destino.id);
  usuarioDestinoPorOrigen.set(Number(agente.id), usuarioId);
  await target.execute({
    sql:
      `INSERT INTO "UsuarioNegocio" (usuarioId, negocioId, rol)
       VALUES (?, ?, 'agente')
       ON CONFLICT(usuarioId, negocioId) DO NOTHING`,
    args: [usuarioId, negocioId],
  });
  await target.execute({
    sql:
      `INSERT INTO "_importacion_legacy" (origen, entidad, sourceId, targetId)
       VALUES (?, 'Agente', ?, ?)
       ON CONFLICT(origen, entidad, sourceId) DO UPDATE SET targetId = excluded.targetId`,
    args: [origen, String(agente.id), usuarioId],
  });
}

const convDestino = new Map();
for (const conv of conversaciones) {
  const asignadoA = conv.asignadoA == null ? null : usuarioDestinoPorOrigen.get(Number(conv.asignadoA)) || null;
  await target.execute({
    sql:
      `INSERT INTO "Conversacion"
        (negocioId, numero, nombre, estado, canalId, asignadoA, asignadoNombre, etiquetas, valoracion, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(negocioId, numero) DO UPDATE SET
         nombre = COALESCE(excluded.nombre, nombre),
         estado = excluded.estado,
         canalId = COALESCE(excluded.canalId, canalId),
         asignadoA = excluded.asignadoA,
         asignadoNombre = excluded.asignadoNombre,
         etiquetas = excluded.etiquetas,
         valoracion = excluded.valoracion,
         updatedAt = MAX(updatedAt, excluded.updatedAt)`,
    args: [
      negocioId,
      String(conv.numero),
      conv.nombre || null,
      conv.estado === "humano" ? "humano" : "bot",
      conv.canal ? canalPorPhone.get(String(conv.canal)) || null : null,
      asignadoA,
      asignadoA ? conv.asignadoNombre || null : null,
      conv.etiquetas || null,
      conv.valoracion || null,
      conv.updatedAt || new Date().toISOString(),
    ],
  });
  const destino = await one(target, 'SELECT id FROM "Conversacion" WHERE negocioId = ? AND numero = ?', [
    negocioId,
    String(conv.numero),
  ]);
  convDestino.set(String(conv.numero), Number(destino.id));
  await target.execute({
    sql:
      `INSERT INTO "_importacion_legacy" (origen, entidad, sourceId, targetId)
       VALUES (?, 'Conversacion', ?, ?)
       ON CONFLICT(origen, entidad, sourceId) DO UPDATE SET targetId = excluded.targetId`,
    args: [origen, String(conv.numero), Number(destino.id)],
  });
}

for (const mensaje of mensajes) {
  const conversacionId = convDestino.get(String(mensaje.numero));
  if (!conversacionId) continue;
  await target.execute({
    sql:
      `INSERT OR IGNORE INTO "Mensaje"
        (conversacionId, negocioId, rol, contenido, idExterno, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      conversacionId,
      negocioId,
      ["user", "assistant", "humano"].includes(mensaje.rol) ? mensaje.rol : "assistant",
      mensaje.contenido || "",
      `legacy:${clave}:mensaje:${mensaje.id}`,
      mensaje.ts || new Date().toISOString(),
    ],
  });
  await target.execute({
    sql:
      `INSERT INTO "_importacion_legacy" (origen, entidad, sourceId, targetId)
       VALUES (?, 'Mensaje', ?, NULL)
       ON CONFLICT(origen, entidad, sourceId) DO NOTHING`,
    args: [origen, String(mensaje.id)],
  });
}

for (const nota of notas) {
  const ya = await one(
    target,
    `SELECT 1 AS ok FROM "_importacion_legacy" WHERE origen = ? AND entidad = 'Nota' AND sourceId = ?`,
    [origen, String(nota.id)]
  );
  if (ya) continue;
  const conversacionId = convDestino.get(String(nota.numero));
  if (!conversacionId) continue;
  const usuarioId = nota.agenteId == null ? null : usuarioDestinoPorOrigen.get(Number(nota.agenteId)) || null;
  const insertada = await target.execute({
    sql:
      `INSERT INTO "Nota" (conversacionId, negocioId, usuarioId, usuarioNombre, texto, ts)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [conversacionId, negocioId, usuarioId, nota.agenteNombre || null, nota.texto, nota.ts || new Date().toISOString()],
  });
  await target.execute({
    sql: `INSERT INTO "_importacion_legacy" (origen, entidad, sourceId, targetId) VALUES (?, 'Nota', ?, ?)`,
    args: [origen, String(nota.id), Number(insertada.rows[0].id)],
  });
}

for (const atajo of atajos) {
  const ya = await one(
    target,
    `SELECT 1 AS ok FROM "_importacion_legacy" WHERE origen = ? AND entidad = 'Atajo' AND sourceId = ?`,
    [origen, String(atajo.id)]
  );
  if (ya) continue;
  const insertado = await target.execute({
    sql:
      `INSERT INTO "Atajo" (negocioId, clave, texto)
       VALUES (?, ?, ?)
       ON CONFLICT(negocioId, clave) WHERE negocioId IS NOT NULL
       DO UPDATE SET texto = excluded.texto
       RETURNING id`,
    args: [negocioId, atajo.clave, atajo.texto],
  });
  await target.execute({
    sql: `INSERT INTO "_importacion_legacy" (origen, entidad, sourceId, targetId) VALUES (?, 'Atajo', ?, ?)`,
    args: [origen, String(atajo.id), Number(insertado.rows[0].id)],
  });
}

console.log("Importación aplicada correctamente. Es seguro repetirla para cerrar el delta.");
source.close();
target.close();
