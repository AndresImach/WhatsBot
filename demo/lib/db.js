// Persistencia en Turso (libSQL) por HTTP, sin dependencias. Usa la base
// LOG_TURSO_* (la misma de DemoChatLog): separada de cualquier base real de
// un cliente. Guarda el hilo de cada conversación del demo y si está en
// 'bot' (responde el modelo) o 'humano' (la tomó una persona del backoffice).

function _tursoArg(v) {
  if (v === null || v === undefined) return { type: "null", value: null };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  }
  return { type: "text", value: String(v) };
}
function _decode(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer" || cell.type === "float") return Number(cell.value);
  return cell.value;
}
async function turso(sql, args = []) {
  const raw = process.env.LOG_TURSO_DATABASE_URL || "";
  const base = raw.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  const r = await fetch(base + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + (process.env.LOG_TURSO_AUTH_TOKEN || ""), "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: args.map(_tursoArg) } }, { type: "close" }] }),
  });
  const d = await r.json();
  const res = d.results && d.results[0];
  if (!res || res.type !== "ok") throw new Error("Turso: " + JSON.stringify(res?.error || d).slice(0, 200));
  const rr = res.response.result;
  return rr.rows.map((row) => Object.fromEntries(row.map((c, i) => [rr.cols[i].name, _decode(c)])));
}

const COLUMNAS_CONVERSACION = 'convId, negocio, estado, asignadoA, asignadoNombre, etiquetas, updatedAt';

export async function upsertConversacion(convId, negocio) {
  await turso(
    "INSERT INTO \"DemoConversacion\" (convId, negocio, estado, updatedAt) VALUES (?, ?, 'bot', datetime('now')) " +
      "ON CONFLICT(convId) DO UPDATE SET negocio = COALESCE(excluded.negocio, negocio), updatedAt = datetime('now')",
    [convId, negocio || null]
  );
}

export async function getConversacion(convId) {
  const rows = await turso(`SELECT ${COLUMNAS_CONVERSACION} FROM "DemoConversacion" WHERE convId = ? LIMIT 1`, [convId]);
  return rows[0] || null;
}

export async function setEstado(convId, estado) {
  await turso('UPDATE "DemoConversacion" SET estado = ?, updatedAt = datetime(\'now\') WHERE convId = ?', [estado, convId]);
}

// Devuelve el id de la fila insertada, para que quien llama pueda usarlo
// como cursor de polling (ver demo/api/poll.js).
export async function agregarMensaje(convId, rol, contenido) {
  await turso('INSERT INTO "DemoMensaje" (convId, rol, contenido) VALUES (?, ?, ?)', [convId, rol, contenido]);
  const rows = await turso('SELECT id FROM "DemoMensaje" WHERE convId = ? ORDER BY id DESC LIMIT 1', [convId]);
  return rows[0]?.id ?? null;
}

// Para el widget: solo los mensajes nuevos desde el último id que ya vio.
export async function listarMensajesDesde(convId, desdeId = 0) {
  return turso('SELECT id, rol, contenido, ts FROM "DemoMensaje" WHERE convId = ? AND id > ? ORDER BY id ASC', [convId, desdeId]);
}

// Para el backoffice. Todos los filtros son opcionales y se combinan con AND:
//   - estado:    'humano' | 'bot' (la pestaña del backoffice).
//   - negocio:   la clave del negocio (ej: 'sunstar'); sin él, trae los de todos ("Todas").
//   - asignado:  id de agente exacto, o 'sin_asignar'.
//   - etiqueta:  una etiqueta exacta (coincide dentro del CSV).
export async function listarConversaciones(filtros = {}) {
  const { estado, negocio, asignado, etiqueta } = filtros;
  const condiciones = [];
  const args = [];
  if (estado) { condiciones.push("estado = ?"); args.push(estado); }
  if (negocio) { condiciones.push("negocio = ?"); args.push(negocio); }
  if (asignado === "sin_asignar") {
    condiciones.push("asignadoA IS NULL");
  } else if (asignado !== undefined && asignado !== null && asignado !== "") {
    condiciones.push("asignadoA = ?"); args.push(Number(asignado));
  }
  if (etiqueta) { condiciones.push("(',' || COALESCE(etiquetas, '') || ',') LIKE ?"); args.push(`%,${etiqueta},%`); }
  const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
  return turso(`SELECT ${COLUMNAS_CONVERSACION} FROM "DemoConversacion" ${where} ORDER BY updatedAt DESC LIMIT 200`, args);
}
export async function listarMensajes(convId, limite = 300) {
  return turso('SELECT rol, contenido, ts FROM "DemoMensaje" WHERE convId = ? ORDER BY id ASC LIMIT ?', [convId, limite]);
}

// ── Asignación (multi-agente) ──────────────────────────────────────────────
export async function asignar(convId, agenteId, agenteNombre) {
  await turso(
    'UPDATE "DemoConversacion" SET asignadoA = ?, asignadoNombre = ?, updatedAt = datetime(\'now\') WHERE convId = ?',
    [agenteId || null, agenteId ? agenteNombre || null : null, convId]
  );
}

// ── Etiquetas ────────────────────────────────────────────────────────────
export async function setEtiquetas(convId, etiquetas) {
  const limpio = (etiquetas || []).map((t) => String(t).trim()).filter(Boolean);
  await turso('UPDATE "DemoConversacion" SET etiquetas = ?, updatedAt = datetime(\'now\') WHERE convId = ?', [limpio.join(","), convId]);
  return limpio;
}

// ── Notas privadas (nunca las ve el widget del cliente) ─────────────────────
export async function listarNotas(convId) {
  return turso('SELECT id, agenteNombre, texto, ts FROM "DemoNota" WHERE convId = ? ORDER BY id ASC', [convId]);
}

export async function agregarNota(convId, agenteId, agenteNombre, texto) {
  await turso('INSERT INTO "DemoNota" (convId, agenteId, agenteNombre, texto) VALUES (?, ?, ?, ?)', [convId, agenteId || null, agenteNombre || null, texto]);
}

// ── Agentes ──────────────────────────────────────────────────────────────
export async function crearOActualizarAgente(usuario, passwordHash, nombre) {
  await turso(
    'INSERT INTO "Agente" (usuario, passwordHash, nombre, activo) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT(usuario) DO UPDATE SET passwordHash = excluded.passwordHash, nombre = excluded.nombre, activo = 1',
    [usuario, passwordHash, nombre || usuario]
  );
}

export async function getAgentePorUsuario(usuario) {
  const rows = await turso('SELECT id, usuario, passwordHash, nombre, activo FROM "Agente" WHERE usuario = ? LIMIT 1', [usuario]);
  return rows[0] || null;
}

export async function listarAgentes() {
  return turso('SELECT id, usuario, nombre FROM "Agente" WHERE activo = 1 ORDER BY nombre');
}

// ── Atajos (respuestas rápidas), con scoping opcional por negocio ─────────
// Sin negocio: solo los globales (negocio IS NULL). Con negocio: los
// globales + los específicos de ESE negocio.
export async function listarAtajos(negocio) {
  return negocio
    ? turso('SELECT id, negocio, clave, texto FROM "DemoAtajo" WHERE negocio IS NULL OR negocio = ? ORDER BY clave', [negocio])
    : turso('SELECT id, negocio, clave, texto FROM "DemoAtajo" WHERE negocio IS NULL ORDER BY clave');
}

export async function crearAtajo(negocio, clave, texto) {
  await turso('INSERT INTO "DemoAtajo" (negocio, clave, texto) VALUES (?, ?, ?)', [negocio || null, clave, texto]);
}

export async function borrarAtajo(id) {
  await turso('DELETE FROM "DemoAtajo" WHERE id = ?', [id]);
}
