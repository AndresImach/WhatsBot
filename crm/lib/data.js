import { ejecutar, fila, filas, lote, placeholders } from "./client.js";
import { resolverFeatures } from "./features.js";
import { hashApiKey } from "./crypto.js";
import { errorPublico } from "./http.js";

const COLUMNAS_CONVERSACION = `
  c.id, c.negocioId, n.clave AS negocioClave, n.nombre AS negocioNombre,
  c.numero, c.nombre, c.estado, c.canalId, ca.phoneNumberId, ca.nombre AS canalNombre,
  c.asignadoA, c.asignadoNombre, c.etiquetas, c.valoracion, c.datosExtra,
  c.updatedAt, c.createdAt
`;

function idsNumericos(rows) {
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

export async function featuresParaNegocio(negocioId, tier) {
  const [planRows, overrideRows] = await Promise.all([
    filas('SELECT feature, valor FROM "PlanFeature" WHERE tier = ?', [tier]),
    filas('SELECT feature, valor FROM "NegocioFeature" WHERE negocioId = ?', [negocioId]),
  ]);
  return resolverFeatures(planRows, overrideRows);
}

export async function cargarContextoUsuario(usuarioId) {
  const usuario = await fila(
    'SELECT id, usuario, nombre, esSuperAdmin, activo FROM "Usuario" WHERE id = ? AND activo = 1 LIMIT 1',
    [usuarioId]
  );
  if (!usuario) return null;

  const negocios = usuario.esSuperAdmin
    ? await filas('SELECT id, clave, nombre, tier, activo, \'superadmin\' AS rol FROM "Negocio" WHERE activo = 1 ORDER BY nombre')
    : await filas(
        `SELECT n.id, n.clave, n.nombre, n.tier, n.activo, un.rol
           FROM "UsuarioNegocio" un
           JOIN "Negocio" n ON n.id = un.negocioId
          WHERE un.usuarioId = ? AND n.activo = 1
          ORDER BY n.nombre`,
        [usuario.id]
      );

  const enriquecidos = await Promise.all(
    negocios.map(async (negocio) => ({
      ...negocio,
      id: Number(negocio.id),
      features: await featuresParaNegocio(Number(negocio.id), negocio.tier),
    }))
  );

  return {
    usuario: {
      id: Number(usuario.id),
      usuario: usuario.usuario,
      nombre: usuario.nombre || usuario.usuario,
      esSuperAdmin: !!usuario.esSuperAdmin,
    },
    negocios: enriquecidos,
  };
}

export async function getUsuarioPorNombre(usuario) {
  return fila(
    'SELECT id, usuario, passwordHash, nombre, esSuperAdmin, activo FROM "Usuario" WHERE usuario = ? LIMIT 1',
    [usuario]
  );
}

export async function getUsuarioPorId(id) {
  return fila(
    'SELECT id, usuario, passwordHash, nombre, esSuperAdmin, activo FROM "Usuario" WHERE id = ? LIMIT 1',
    [id]
  );
}

export async function contarUsuariosNegocio(negocioId) {
  const row = await fila('SELECT COUNT(*) AS cantidad FROM "UsuarioNegocio" WHERE negocioId = ?', [negocioId]);
  return Number(row?.cantidad || 0);
}

export async function getMembresia(usuarioId, negocioId) {
  return fila(
    'SELECT usuarioId, negocioId, rol FROM "UsuarioNegocio" WHERE usuarioId = ? AND negocioId = ? LIMIT 1',
    [usuarioId, negocioId]
  );
}

export async function autenticarBot(apiKey) {
  const keyHash = hashApiKey(apiKey);
  const encontrada = await fila(
    `SELECT k.id AS keyId, k.negocioId, n.clave, n.nombre, n.tier
       FROM "BotApiKey" k
       JOIN "Negocio" n ON n.id = k.negocioId
      WHERE k.keyHash = ? AND k.activo = 1 AND n.activo = 1
      LIMIT 1`,
    [keyHash]
  );
  if (!encontrada) return null;
  await ejecutar('UPDATE "BotApiKey" SET lastUsedAt = datetime(\'now\') WHERE id = ?', [encontrada.keyId]);
  return {
    keyId: Number(encontrada.keyId),
    negocioId: Number(encontrada.negocioId),
    clave: encontrada.clave,
    nombre: encontrada.nombre,
    tier: encontrada.tier,
  };
}

async function resolverCanal(negocioId, phoneNumberId) {
  if (phoneNumberId) {
    const canal = await fila(
      `SELECT id, phoneNumberId, nombre
         FROM "Canal"
        WHERE negocioId = ? AND phoneNumberId = ? AND activo = 1
        LIMIT 1`,
      [negocioId, phoneNumberId]
    );
    if (!canal) throw errorPublico("Canal de WhatsApp no registrado para este negocio.", 400);
    return canal;
  }
  const canales = await filas(
    'SELECT id, phoneNumberId, nombre FROM "Canal" WHERE negocioId = ? AND activo = 1 ORDER BY id LIMIT 2',
    [negocioId]
  );
  return canales.length === 1 ? canales[0] : null;
}

export async function ingestarMensaje(negocioId, mensaje) {
  const canal = await resolverCanal(negocioId, mensaje.phoneNumberId || null);
  const idExterno = mensaje.idExterno || null;
  const derivar = mensaje.derivar ? 1 : 0;
  const sentencias = [
    {
      sql:
        `INSERT INTO "Conversacion" (negocioId, numero, nombre, estado, canalId, updatedAt)
         VALUES (?, ?, ?, 'bot', ?, datetime('now'))
         ON CONFLICT(negocioId, numero) DO UPDATE SET
           nombre = COALESCE(excluded.nombre, nombre),
           canalId = COALESCE(excluded.canalId, canalId),
           updatedAt = datetime('now')`,
      args: [negocioId, mensaje.numero, mensaje.nombre || null, canal?.id || null],
    },
    {
      sql:
        `INSERT OR IGNORE INTO "Mensaje" (conversacionId, negocioId, rol, contenido, idExterno)
         SELECT id, negocioId, ?, ?, ?
           FROM "Conversacion"
          WHERE negocioId = ? AND numero = ?`,
      args: [mensaje.rol, mensaje.contenido, idExterno, negocioId, mensaje.numero],
    },
    {
      sql:
        `UPDATE "Conversacion"
            SET estado = CASE WHEN ? = 1 THEN 'humano' ELSE estado END,
                updatedAt = datetime('now')
          WHERE negocioId = ? AND numero = ?`,
      args: [derivar, negocioId, mensaje.numero],
    },
  ];
  const resultados = await lote(sentencias);
  const duplicado = !!idExterno && Number(resultados[1]?.rowsAffected || 0) === 0;

  const conversacion = await fila(
    'SELECT id, estado, canalId FROM "Conversacion" WHERE negocioId = ? AND numero = ? LIMIT 1',
    [negocioId, mensaje.numero]
  );
  const historial =
    mensaje.rol === "user"
      ? (
          await filas(
            `SELECT rol, contenido
               FROM "Mensaje"
              WHERE conversacionId = ? AND negocioId = ?
              ORDER BY id DESC LIMIT 20`,
            [conversacion.id, negocioId]
          )
        )
          .reverse()
          .map((m) => ({ role: m.rol === "user" ? "user" : "assistant", content: m.contenido }))
      : undefined;

  return {
    conversacionId: Number(conversacion.id),
    estado: conversacion.estado,
    duplicado,
    ...(historial ? { historial } : {}),
  };
}

export async function derivarPorNumero(negocioId, numero) {
  const resultado = await ejecutar(
    `UPDATE "Conversacion"
        SET estado = 'humano', updatedAt = datetime('now')
      WHERE negocioId = ? AND numero = ?`,
    [negocioId, numero]
  );
  if (!resultado.rowsAffected) throw errorPublico("Conversación inexistente.", 404);
}

export async function listarConversaciones(negocioIds, filtros = {}) {
  const scope = placeholders(negocioIds);
  const condiciones = [`c.negocioId IN (${scope})`];
  const args = [...negocioIds];
  if (filtros.negocioId) {
    condiciones.push("c.negocioId = ?");
    args.push(filtros.negocioId);
  }
  if (filtros.estado) {
    condiciones.push("c.estado = ?");
    args.push(filtros.estado);
  }
  if (filtros.canalId) {
    condiciones.push("c.canalId = ?");
    args.push(filtros.canalId);
  }
  if (filtros.asignado === "sin_asignar") {
    condiciones.push("c.asignadoA IS NULL");
  } else if (filtros.asignado !== undefined && filtros.asignado !== null && filtros.asignado !== "") {
    condiciones.push("c.asignadoA = ?");
    args.push(Number(filtros.asignado));
  }
  if (filtros.etiqueta) {
    condiciones.push("(',' || COALESCE(c.etiquetas, '') || ',') LIKE ?");
    args.push(`%,${filtros.etiqueta},%`);
  }
  const rows = await filas(
    `SELECT ${COLUMNAS_CONVERSACION}
       FROM "Conversacion" c
       JOIN "Negocio" n ON n.id = c.negocioId
       LEFT JOIN "Canal" ca ON ca.id = c.canalId
      WHERE ${condiciones.join(" AND ")}
      ORDER BY c.updatedAt DESC
      LIMIT 200`,
    args
  );
  return idsNumericos(rows).map((row) => ({
    ...row,
    negocioId: Number(row.negocioId),
    canalId: row.canalId == null ? null : Number(row.canalId),
    asignadoA: row.asignadoA == null ? null : Number(row.asignadoA),
  }));
}

export async function getConversacionAutorizada(conversacionId, negocioIds) {
  const scope = placeholders(negocioIds);
  const conv = await fila(
    `SELECT ${COLUMNAS_CONVERSACION}, ca.tokenCifrado
       FROM "Conversacion" c
       JOIN "Negocio" n ON n.id = c.negocioId
       LEFT JOIN "Canal" ca ON ca.id = c.canalId
      WHERE c.id = ? AND c.negocioId IN (${scope})
      LIMIT 1`,
    [conversacionId, ...negocioIds]
  );
  if (!conv) throw errorPublico("Conversación inexistente o no autorizada.", 404);
  return {
    ...conv,
    id: Number(conv.id),
    negocioId: Number(conv.negocioId),
    canalId: conv.canalId == null ? null : Number(conv.canalId),
    asignadoA: conv.asignadoA == null ? null : Number(conv.asignadoA),
  };
}

export async function listarMensajes(conversacionId, negocioId, limite = 300) {
  return filas(
    `SELECT id, rol, contenido, idExterno, ts
       FROM "Mensaje"
      WHERE conversacionId = ? AND negocioId = ?
      ORDER BY id ASC LIMIT ?`,
    [conversacionId, negocioId, limite]
  );
}

export async function guardarMensajeHumano(conversacion, usuario, contenido, idExterno) {
  await lote([
    {
      sql:
        `INSERT OR IGNORE INTO "Mensaje"
          (conversacionId, negocioId, rol, contenido, idExterno)
         VALUES (?, ?, 'humano', ?, ?)`,
      args: [conversacion.id, conversacion.negocioId, contenido, idExterno || null],
    },
    {
      sql:
        `UPDATE "Conversacion"
            SET estado = 'humano',
                asignadoA = COALESCE(asignadoA, ?),
                asignadoNombre = CASE WHEN asignadoA IS NULL THEN ? ELSE asignadoNombre END,
                updatedAt = datetime('now')
          WHERE id = ? AND negocioId = ?`,
      args: [usuario.id, usuario.nombre, conversacion.id, conversacion.negocioId],
    },
  ]);
}

export async function setEstadoConversacion(conversacionId, negocioId, estado) {
  await ejecutar(
    'UPDATE "Conversacion" SET estado = ?, updatedAt = datetime(\'now\') WHERE id = ? AND negocioId = ?',
    [estado, conversacionId, negocioId]
  );
}

export async function asignarConversacion(conversacionId, negocioId, usuario) {
  await ejecutar(
    `UPDATE "Conversacion"
        SET asignadoA = ?, asignadoNombre = ?, updatedAt = datetime('now')
      WHERE id = ? AND negocioId = ?`,
    [usuario?.id || null, usuario?.nombre || null, conversacionId, negocioId]
  );
}

export async function setEtiquetasConversacion(conversacionId, negocioId, etiquetas) {
  const limpias = [...new Set(etiquetas.map((t) => String(t).trim()).filter(Boolean))].slice(0, 30);
  await ejecutar(
    'UPDATE "Conversacion" SET etiquetas = ?, updatedAt = datetime(\'now\') WHERE id = ? AND negocioId = ?',
    [limpias.join(","), conversacionId, negocioId]
  );
  return limpias;
}

export async function setValoracionConversacion(conversacionId, negocioId, valoracion) {
  await ejecutar(
    'UPDATE "Conversacion" SET valoracion = ?, updatedAt = datetime(\'now\') WHERE id = ? AND negocioId = ?',
    [valoracion, conversacionId, negocioId]
  );
}

export async function listarNotas(conversacionId, negocioId) {
  return filas(
    `SELECT id, usuarioId, usuarioNombre, texto, ts
       FROM "Nota"
      WHERE conversacionId = ? AND negocioId = ?
      ORDER BY id ASC`,
    [conversacionId, negocioId]
  );
}

export async function agregarNota(conversacion, usuario, texto) {
  await ejecutar(
    `INSERT INTO "Nota" (conversacionId, negocioId, usuarioId, usuarioNombre, texto)
     VALUES (?, ?, ?, ?, ?)`,
    [conversacion.id, conversacion.negocioId, usuario.id, usuario.nombre, texto]
  );
}

export async function listarUsuariosNegocio(negocioId) {
  const rows = await filas(
    `SELECT u.id, u.usuario, u.nombre, u.activo, un.rol
       FROM "UsuarioNegocio" un
       JOIN "Usuario" u ON u.id = un.usuarioId
      WHERE un.negocioId = ? AND u.activo = 1
      ORDER BY u.nombre, u.usuario`,
    [negocioId]
  );
  return idsNumericos(rows);
}

export async function listarAtajos(negocioId) {
  return filas(
    `SELECT id, negocioId, clave, texto
       FROM "Atajo"
      WHERE negocioId IS NULL OR negocioId = ?
      ORDER BY negocioId IS NOT NULL DESC, clave`,
    [negocioId]
  );
}

export async function crearAtajo(negocioId, clave, texto) {
  await ejecutar('INSERT INTO "Atajo" (negocioId, clave, texto) VALUES (?, ?, ?)', [negocioId, clave, texto]);
}

export async function borrarAtajo(id, negocioIds, permitirGlobal = false) {
  const scope = placeholders(negocioIds);
  const resultado = await ejecutar(
    `DELETE FROM "Atajo"
      WHERE id = ?
        AND (negocioId IN (${scope})${permitirGlobal ? " OR negocioId IS NULL" : ""})`,
    [id, ...negocioIds]
  );
  if (!resultado.rowsAffected) throw errorPublico("Atajo inexistente o no autorizado.", 404);
}

export async function estadoAdministracion(negocioIds, esSuperAdmin) {
  const scope = negocioIds.length ? placeholders(negocioIds) : "";
  const condicion = esSuperAdmin ? "1 = 1" : `n.id IN (${scope})`;
  const args = esSuperAdmin ? [] : negocioIds;
  const [negocios, usuarios, membresias, canales, keys, planFeatures, overrides] = await Promise.all([
    filas(`SELECT n.id, n.clave, n.nombre, n.tier, n.activo, n.createdAt FROM "Negocio" n WHERE ${condicion} ORDER BY n.nombre`, args),
    esSuperAdmin
      ? filas('SELECT id, usuario, nombre, esSuperAdmin, activo, createdAt FROM "Usuario" ORDER BY nombre, usuario')
      : filas(
          `SELECT DISTINCT u.id, u.usuario, u.nombre, u.esSuperAdmin, u.activo, u.createdAt
             FROM "Usuario" u JOIN "UsuarioNegocio" un ON un.usuarioId = u.id
            WHERE un.negocioId IN (${scope}) ORDER BY u.nombre, u.usuario`,
          negocioIds
        ),
    filas(
      `SELECT un.usuarioId, un.negocioId, un.rol
         FROM "UsuarioNegocio" un
         JOIN "Negocio" n ON n.id = un.negocioId
        WHERE ${condicion}`,
      args
    ),
    filas(
      `SELECT c.id, c.negocioId, c.phoneNumberId, c.nombre, c.activo,
              CASE WHEN c.tokenCifrado IS NULL THEN 0 ELSE 1 END AS tieneToken
         FROM "Canal" c JOIN "Negocio" n ON n.id = c.negocioId
        WHERE ${condicion} ORDER BY c.negocioId, c.nombre`,
      args
    ),
    esSuperAdmin
      ? filas(
          `SELECT k.id, k.negocioId, k.nombre, k.keySuffix, k.activo, k.lastUsedAt, k.createdAt, k.revokedAt
             FROM "BotApiKey" k ORDER BY k.negocioId, k.createdAt DESC`
        )
      : [],
    esSuperAdmin ? filas('SELECT tier, feature, valor FROM "PlanFeature" ORDER BY tier, feature') : [],
    filas(
      `SELECT nf.negocioId, nf.feature, nf.valor
         FROM "NegocioFeature" nf JOIN "Negocio" n ON n.id = nf.negocioId
        WHERE ${condicion} ORDER BY nf.negocioId, nf.feature`,
      args
    ),
  ]);
  return { negocios, usuarios, membresias, canales, keys, planFeatures, overrides };
}

export async function crearNegocio({ clave, nombre, tier = "full" }) {
  const resultado = await ejecutar(
    'INSERT INTO "Negocio" (clave, nombre, tier) VALUES (?, ?, ?) RETURNING id',
    [clave, nombre, tier]
  );
  return Number(resultado.rows[0].id);
}

export async function actualizarNegocio({ id, clave, nombre, tier, activo }) {
  await ejecutar(
    `UPDATE "Negocio"
        SET clave = ?, nombre = ?, tier = ?, activo = ?, updatedAt = datetime('now')
      WHERE id = ?`,
    [clave, nombre, tier, activo ? 1 : 0, id]
  );
}

export async function crearUsuario({ usuario, passwordHash, nombre, esSuperAdmin = false }) {
  const resultado = await ejecutar(
    `INSERT INTO "Usuario" (usuario, passwordHash, nombre, esSuperAdmin)
     VALUES (?, ?, ?, ?) RETURNING id`,
    [usuario, passwordHash, nombre || usuario, esSuperAdmin ? 1 : 0]
  );
  return Number(resultado.rows[0].id);
}

export async function actualizarUsuario({ id, nombre, activo, esSuperAdmin, passwordHash }) {
  const partes = ["nombre = ?", "activo = ?", "esSuperAdmin = ?", "updatedAt = datetime('now')"];
  const args = [nombre, activo ? 1 : 0, esSuperAdmin ? 1 : 0];
  if (passwordHash) {
    partes.push("passwordHash = ?");
    args.push(passwordHash);
  }
  args.push(id);
  await ejecutar(`UPDATE "Usuario" SET ${partes.join(", ")} WHERE id = ?`, args);
}

export async function guardarMembresia(usuarioId, negocioId, rol) {
  await ejecutar(
    `INSERT INTO "UsuarioNegocio" (usuarioId, negocioId, rol)
     VALUES (?, ?, ?)
     ON CONFLICT(usuarioId, negocioId) DO UPDATE SET rol = excluded.rol`,
    [usuarioId, negocioId, rol]
  );
}

export async function borrarMembresia(usuarioId, negocioId) {
  await ejecutar('DELETE FROM "UsuarioNegocio" WHERE usuarioId = ? AND negocioId = ?', [usuarioId, negocioId]);
}

export async function guardarCanal({ id, negocioId, phoneNumberId, nombre, tokenCifrado, activo = true }) {
  if (id) {
    const partes = [
      "phoneNumberId = ?",
      "nombre = ?",
      "activo = ?",
      "updatedAt = datetime('now')",
    ];
    const args = [phoneNumberId, nombre || null, activo ? 1 : 0];
    if (tokenCifrado) {
      partes.push("tokenCifrado = ?");
      args.push(tokenCifrado);
    }
    args.push(id, negocioId);
    await ejecutar(`UPDATE "Canal" SET ${partes.join(", ")} WHERE id = ? AND negocioId = ?`, args);
    return id;
  }
  const resultado = await ejecutar(
    `INSERT INTO "Canal" (negocioId, phoneNumberId, nombre, tokenCifrado, activo)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [negocioId, phoneNumberId, nombre || null, tokenCifrado || null, activo ? 1 : 0]
  );
  return Number(resultado.rows[0].id);
}

export async function crearBotApiKey({ negocioId, nombre, keyHash, keySuffix }) {
  const resultado = await ejecutar(
    `INSERT INTO "BotApiKey" (negocioId, nombre, keyHash, keySuffix)
     VALUES (?, ?, ?, ?) RETURNING id`,
    [negocioId, nombre, keyHash, keySuffix]
  );
  return Number(resultado.rows[0].id);
}

export async function revocarBotApiKey(id) {
  await ejecutar(
    `UPDATE "BotApiKey"
        SET activo = 0, revokedAt = datetime('now')
      WHERE id = ?`,
    [id]
  );
}

export async function guardarPlanFeature(tier, feature, valor) {
  await ejecutar(
    `INSERT INTO "PlanFeature" (tier, feature, valor) VALUES (?, ?, ?)
     ON CONFLICT(tier, feature) DO UPDATE SET valor = excluded.valor`,
    [tier, feature, valor]
  );
}

export async function guardarOverride(negocioId, feature, valor) {
  if (valor === null || valor === undefined || valor === "") {
    await ejecutar('DELETE FROM "NegocioFeature" WHERE negocioId = ? AND feature = ?', [negocioId, feature]);
    return;
  }
  await ejecutar(
    `INSERT INTO "NegocioFeature" (negocioId, feature, valor) VALUES (?, ?, ?)
     ON CONFLICT(negocioId, feature) DO UPDATE SET valor = excluded.valor`,
    [negocioId, feature, valor]
  );
}
