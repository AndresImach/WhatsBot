// Persistencia en Turso (libSQL) por HTTP, sin dependencias — mismo patrón que
// bot/lib/db.js. Acá viven los pedidos, el catálogo y el horario de la PWA.

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
function _rows(res) {
  const rr = res.response.result;
  return rr.rows.map((row) => Object.fromEntries(row.map((c, i) => [rr.cols[i].name, _decode(c)])));
}

// Ejecuta uno o varios statements en una sola "pipeline" (misma conexión, para
// que last_insert_rowid() valga). Devuelve un array con las filas de cada uno.
async function tursoBatch(statements) {
  const raw = process.env.TURSO_DATABASE_URL || "";
  const base = raw.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  const requests = statements.map((s) => ({ type: "execute", stmt: { sql: s.sql, args: (s.args || []).map(_tursoArg) } }));
  requests.push({ type: "close" });
  const r = await fetch(base + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + (process.env.TURSO_AUTH_TOKEN || ""), "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  const d = await r.json();
  return statements.map((_, i) => {
    const res = d.results && d.results[i];
    if (!res || res.type !== "ok") throw new Error("Turso: " + JSON.stringify(res?.error || d).slice(0, 200));
    return _rows(res);
  });
}
async function turso(sql, args = []) {
  return (await tursoBatch([{ sql, args }]))[0];
}

// ─────────────────────────── Pedidos ───────────────────────────

// Une cada pedido con sus ítems en una sola pasada (2 queries, agrupado en JS).
async function _conItems(pedidos) {
  if (!pedidos.length) return [];
  const ids = pedidos.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = await turso(
    `SELECT id, pedido_id, catalogo_item_id, nombre, cantidad_pedida, unidad, estado_item, cantidad_confirmada
       FROM "PedidoItem" WHERE pedido_id IN (${placeholders}) ORDER BY id ASC`,
    ids
  );
  const porPedido = {};
  for (const it of items) (porPedido[it.pedido_id] ||= []).push(it);
  return pedidos.map((p) => ({ ...p, items: porPedido[p.id] || [] }));
}

// Lo usa el bot: crea el pedido en estado 'pendiente' con todos sus ítems.
// Devuelve el pedido completo (con items) recién creado.
export async function crearPedido({ cliente_telefono, cliente_nombre, fuera_de_horario, nota, items }) {
  const res = await tursoBatch([
    {
      sql: 'INSERT INTO "Pedido" (cliente_telefono, cliente_nombre, fuera_de_horario, nota) VALUES (?, ?, ?, ?)',
      args: [cliente_telefono || null, cliente_nombre || null, fuera_de_horario ? 1 : 0, nota || null],
    },
    { sql: "SELECT last_insert_rowid() AS id" },
  ]);
  const pedidoId = res[1][0].id;
  const inserts = items.map((it) => ({
    sql: 'INSERT INTO "PedidoItem" (pedido_id, catalogo_item_id, nombre, cantidad_pedida, unidad) VALUES (?, ?, ?, ?, ?)',
    args: [pedidoId, it.catalogo_item_id ?? null, String(it.nombre), Number(it.cantidad_pedida), it.unidad || "unidad"],
  }));
  if (inserts.length) await tursoBatch(inserts);
  return (await getPedido(pedidoId));
}

export async function listarPedidos({ estado, desde, hasta } = {}) {
  const where = [];
  const args = [];
  if (estado) { where.push("estado = ?"); args.push(estado); }
  if (desde) { where.push("creado_en >= ?"); args.push(desde + " 00:00:00"); }
  if (hasta) { where.push("creado_en <= ?"); args.push(hasta + " 23:59:59"); }
  const sql =
    'SELECT id, cliente_telefono, cliente_nombre, estado, creado_en, confirmado_en, fuera_de_horario, nota FROM "Pedido"' +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    // más viejo primero cuando es la cola; más nuevo primero para historial
    (estado === "pendiente" ? " ORDER BY creado_en ASC" : " ORDER BY creado_en DESC") +
    " LIMIT 300";
  return _conItems(await turso(sql, args));
}

export async function getPedido(id) {
  const p = await turso(
    'SELECT id, cliente_telefono, cliente_nombre, estado, creado_en, confirmado_en, fuera_de_horario, nota FROM "Pedido" WHERE id = ? LIMIT 1',
    [id]
  );
  if (!p.length) return null;
  return (await _conItems(p))[0];
}

// Actualiza el estado de un ítem (confirmado / no_disponible / editado).
// 'editado' guarda además cantidad_confirmada.
export async function actualizarItem(pedidoId, { id, estado_item, cantidad_confirmada }) {
  const cant = estado_item === "editado" ? Number(cantidad_confirmada) : null;
  await turso(
    'UPDATE "PedidoItem" SET estado_item = ?, cantidad_confirmada = ? WHERE id = ? AND pedido_id = ?',
    [estado_item, cant, id, pedidoId]
  );
}

// Cierra la revisión del carnicero: los ítems que quedaron 'pendiente' pasan a
// 'confirmado' (confirmar todo tal cual), y el pedido queda 'confirmado_carnicero'.
export async function confirmarPedido(pedidoId) {
  await tursoBatch([
    { sql: 'UPDATE "PedidoItem" SET estado_item = \'confirmado\' WHERE pedido_id = ? AND estado_item = \'pendiente\'', args: [pedidoId] },
    { sql: 'UPDATE "Pedido" SET estado = \'confirmado_carnicero\', confirmado_en = datetime(\'now\') WHERE id = ?', args: [pedidoId] },
  ]);
  return getPedido(pedidoId);
}

// Lo usa el bot cuando termina la conversación con el cliente.
export async function setEstadoPedido(pedidoId, estado) {
  await turso('UPDATE "Pedido" SET estado = ? WHERE id = ?', [estado, pedidoId]);
  return getPedido(pedidoId);
}

// ─────────────────────────── Catálogo ───────────────────────────

export async function listarCatalogo({ soloActivos } = {}) {
  return turso(
    'SELECT id, nombre, unidad, precio, activo FROM "Catalogo"' +
      (soloActivos ? " WHERE activo = 1" : "") +
      " ORDER BY activo DESC, nombre ASC"
  );
}

export async function crearProducto({ nombre, unidad, precio, activo }) {
  const res = await tursoBatch([
    { sql: 'INSERT INTO "Catalogo" (nombre, unidad, precio, activo) VALUES (?, ?, ?, ?)', args: [nombre, unidad || "unidad", precio ?? null, activo === false ? 0 : 1] },
    { sql: "SELECT last_insert_rowid() AS id" },
  ]);
  return getProducto(res[1][0].id);
}

export async function getProducto(id) {
  const r = await turso('SELECT id, nombre, unidad, precio, activo FROM "Catalogo" WHERE id = ? LIMIT 1', [id]);
  return r[0] || null;
}

export async function actualizarProducto(id, campos) {
  const cols = [];
  const args = [];
  for (const k of ["nombre", "unidad", "precio", "activo"]) {
    if (campos[k] === undefined) continue;
    cols.push(`${k} = ?`);
    args.push(k === "activo" ? (campos[k] ? 1 : 0) : campos[k]);
  }
  if (!cols.length) return getProducto(id);
  args.push(id);
  await turso(`UPDATE "Catalogo" SET ${cols.join(", ")} WHERE id = ?`, args);
  return getProducto(id);
}

export async function borrarProducto(id) {
  await turso('DELETE FROM "Catalogo" WHERE id = ?', [id]);
}

// ─────────────────────────── Horario ───────────────────────────

export async function getHorario() {
  const rows = await turso('SELECT dia, abierto, apertura, cierre FROM "Horario" ORDER BY dia ASC');
  // Siempre devolvemos los 7 días, aunque falten filas en la base.
  const porDia = {};
  for (const r of rows) porDia[r.dia] = r;
  return Array.from({ length: 7 }, (_, dia) => porDia[dia] || { dia, abierto: 0, apertura: null, cierre: null });
}

export async function setHorario(dias) {
  const stmts = dias.map((d) => ({
    sql: 'INSERT INTO "Horario" (dia, abierto, apertura, cierre) VALUES (?, ?, ?, ?) ' +
      "ON CONFLICT(dia) DO UPDATE SET abierto = excluded.abierto, apertura = excluded.apertura, cierre = excluded.cierre",
    args: [d.dia, d.abierto ? 1 : 0, d.apertura || null, d.cierre || null],
  }));
  if (stmts.length) await tursoBatch(stmts);
  return getHorario();
}
