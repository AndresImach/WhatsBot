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

export async function upsertConversacion(convId, negocio) {
  await turso(
    "INSERT INTO \"DemoConversacion\" (convId, negocio, estado, updatedAt) VALUES (?, ?, 'bot', datetime('now')) " +
      "ON CONFLICT(convId) DO UPDATE SET negocio = COALESCE(excluded.negocio, negocio), updatedAt = datetime('now')",
    [convId, negocio || null]
  );
}

export async function getConversacion(convId) {
  const rows = await turso('SELECT convId, negocio, estado, updatedAt FROM "DemoConversacion" WHERE convId = ? LIMIT 1', [convId]);
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

// Para el backoffice.
export async function listarConversaciones(estado) {
  return estado
    ? turso('SELECT convId, negocio, estado, updatedAt FROM "DemoConversacion" WHERE estado = ? ORDER BY updatedAt DESC LIMIT 200', [estado])
    : turso('SELECT convId, negocio, estado, updatedAt FROM "DemoConversacion" ORDER BY updatedAt DESC LIMIT 200');
}
export async function listarMensajes(convId, limite = 300) {
  return turso('SELECT rol, contenido, ts FROM "DemoMensaje" WHERE convId = ? ORDER BY id ASC LIMIT ?', [convId, limite]);
}
