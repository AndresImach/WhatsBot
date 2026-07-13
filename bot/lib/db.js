// Persistencia en Turso (libSQL) por HTTP, sin dependencias.
// Reemplaza el historial en memoria de webhook.js: guarda cada mensaje y el
// estado de cada conversación ('bot' | 'humano', ver schema.sql).

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
  const raw = process.env.TURSO_DATABASE_URL || "";
  const base = raw.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  const r = await fetch(base + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + (process.env.TURSO_AUTH_TOKEN || ""), "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: args.map(_tursoArg) } }, { type: "close" }] }),
  });
  const d = await r.json();
  const res = d.results && d.results[0];
  if (!res || res.type !== "ok") throw new Error("Turso: " + JSON.stringify(res?.error || d).slice(0, 200));
  const rr = res.response.result;
  return rr.rows.map((row) => Object.fromEntries(row.map((c, i) => [rr.cols[i].name, _decode(c)])));
}

// Crea la conversación si no existe (queda en estado 'bot'); si ya existe, solo
// actualiza el nombre de contacto (si vino uno nuevo) y el updatedAt.
export async function upsertConversacion(numero, nombre) {
  await turso(
    "INSERT INTO \"Conversacion\" (numero, nombre, estado, updatedAt) VALUES (?, ?, 'bot', datetime('now')) " +
      "ON CONFLICT(numero) DO UPDATE SET nombre = COALESCE(excluded.nombre, nombre), updatedAt = datetime('now')",
    [numero, nombre || null]
  );
}

export async function getConversacion(numero) {
  const rows = await turso('SELECT numero, nombre, estado, updatedAt FROM "Conversacion" WHERE numero = ? LIMIT 1', [numero]);
  return rows[0] || null;
}

export async function setEstado(numero, estado) {
  await turso('UPDATE "Conversacion" SET estado = ?, updatedAt = datetime(\'now\') WHERE numero = ?', [estado, numero]);
}

export async function agregarMensaje(numero, rol, contenido) {
  await turso('INSERT INTO "Mensaje" (numero, rol, contenido) VALUES (?, ?, ?)', [numero, rol, contenido]);
}

// Historial en el formato que espera router.responder(): [{role: 'user'|'assistant', content}].
// Los mensajes 'humano' (respondidos a mano desde el backoffice) cuentan como 'assistant'
// para el modelo: de cara al cliente, es el mismo negocio respondiendo.
export async function historialParaModelo(numero, maxMensajes = 12) {
  const rows = await turso(
    'SELECT rol, contenido FROM "Mensaje" WHERE numero = ? ORDER BY id DESC LIMIT ?',
    [numero, maxMensajes]
  );
  return rows.reverse().map((m) => ({ role: m.rol === "user" ? "user" : "assistant", content: m.contenido }));
}

// Para el backoffice: lista de conversaciones (opcionalmente filtradas por estado).
export async function listarConversaciones(estado) {
  return estado
    ? turso('SELECT numero, nombre, estado, updatedAt FROM "Conversacion" WHERE estado = ? ORDER BY updatedAt DESC LIMIT 200', [estado])
    : turso('SELECT numero, nombre, estado, updatedAt FROM "Conversacion" ORDER BY updatedAt DESC LIMIT 200');
}

// Para el backoffice: el hilo completo de una conversación puntual.
export async function listarMensajes(numero, limite = 300) {
  return turso('SELECT rol, contenido, ts FROM "Mensaje" WHERE numero = ? ORDER BY id ASC LIMIT ?', [numero, limite]);
}
