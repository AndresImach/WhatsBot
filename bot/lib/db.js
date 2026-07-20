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

const COLUMNAS_CONVERSACION = 'numero, nombre, estado, canal, canalNombre, asignadoA, asignadoNombre, etiquetas, updatedAt';

// Crea la conversación si no existe (queda en estado 'bot'); si ya existe, solo
// actualiza el nombre de contacto/canal (si vinieron) y el updatedAt.
export async function upsertConversacion(numero, nombre, canal, canalNombre) {
  await turso(
    "INSERT INTO \"Conversacion\" (numero, nombre, estado, canal, canalNombre, updatedAt) VALUES (?, ?, 'bot', ?, ?, datetime('now')) " +
      "ON CONFLICT(numero) DO UPDATE SET nombre = COALESCE(excluded.nombre, nombre), " +
      "canal = COALESCE(excluded.canal, canal), canalNombre = COALESCE(excluded.canalNombre, canalNombre), updatedAt = datetime('now')",
    [numero, nombre || null, canal || null, canalNombre || null]
  );
}

export async function getConversacion(numero) {
  const rows = await turso(`SELECT ${COLUMNAS_CONVERSACION} FROM "Conversacion" WHERE numero = ? LIMIT 1`, [numero]);
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

// Para el backoffice: lista de conversaciones filtrada.
// filtros.estado    → 'bot' | 'humano'
// filtros.canal     → phone_number_id exacto (bandeja unificada)
// filtros.asignado  → id de agente exacto, o 'sin_asignar'
// filtros.etiqueta  → una etiqueta exacta (coincide dentro del CSV)
export async function listarConversaciones(filtros = {}) {
  const { estado, canal, asignado, etiqueta } = filtros;
  const condiciones = [];
  const args = [];
  if (estado) { condiciones.push("estado = ?"); args.push(estado); }
  if (canal) { condiciones.push("canal = ?"); args.push(canal); }
  if (asignado === "sin_asignar") {
    condiciones.push("asignadoA IS NULL");
  } else if (asignado !== undefined && asignado !== null && asignado !== "") {
    condiciones.push("asignadoA = ?"); args.push(Number(asignado));
  }
  if (etiqueta) { condiciones.push("(',' || COALESCE(etiquetas, '') || ',') LIKE ?"); args.push(`%,${etiqueta},%`); }
  const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";
  return turso(`SELECT ${COLUMNAS_CONVERSACION} FROM "Conversacion" ${where} ORDER BY updatedAt DESC LIMIT 200`, args);
}

// Para el backoffice: el hilo completo de una conversación puntual.
export async function listarMensajes(numero, limite = 300) {
  return turso('SELECT rol, contenido, ts FROM "Mensaje" WHERE numero = ? ORDER BY id ASC LIMIT ?', [numero, limite]);
}

// ── Asignación (multi-agente) ──────────────────────────────────────────────
export async function asignar(numero, agenteId, agenteNombre) {
  await turso(
    'UPDATE "Conversacion" SET asignadoA = ?, asignadoNombre = ?, updatedAt = datetime(\'now\') WHERE numero = ?',
    [agenteId || null, agenteId ? agenteNombre || null : null, numero]
  );
}

// ── Etiquetas ────────────────────────────────────────────────────────────
export async function setEtiquetas(numero, etiquetas) {
  const limpio = (etiquetas || []).map((t) => String(t).trim()).filter(Boolean);
  await turso('UPDATE "Conversacion" SET etiquetas = ?, updatedAt = datetime(\'now\') WHERE numero = ?', [limpio.join(","), numero]);
  return limpio;
}

// ── Notas privadas (nunca se mandan por WhatsApp ni entran a historialParaModelo) ──
export async function listarNotas(numero) {
  return turso('SELECT id, agenteNombre, texto, ts FROM "Nota" WHERE numero = ? ORDER BY id ASC', [numero]);
}

export async function agregarNota(numero, agenteId, agenteNombre, texto) {
  await turso('INSERT INTO "Nota" (numero, agenteId, agenteNombre, texto) VALUES (?, ?, ?, ?)', [numero, agenteId || null, agenteNombre || null, texto]);
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

// ── Atajos (respuestas rápidas) ────────────────────────────────────────────
export async function listarAtajos() {
  return turso('SELECT id, clave, texto FROM "Atajo" ORDER BY clave');
}

export async function crearAtajo(clave, texto) {
  await turso('INSERT INTO "Atajo" (clave, texto) VALUES (?, ?)', [clave, texto]);
}

export async function borrarAtajo(id) {
  await turso('DELETE FROM "Atajo" WHERE id = ?', [id]);
}
