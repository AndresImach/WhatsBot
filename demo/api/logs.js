// Devuelve el resumen de conversaciones del demo (tabla DemoChatLog en una base
// de Turso SEPARADA, exclusiva del demo — no vive en la base de ningún cliente),
// agrupadas por convId, con sus mensajes, modelo y costo por turno.
// Lo consume resumen.html.
//
// Acceso: si definís LOG_TOKEN en las env vars, hay que pasar ?key=<LOG_TOKEN>.
// Si no lo definís, queda abierto (ojo: expone los mensajes de los clientes).
async function turso(sql, args = []) {
  const raw = process.env.LOG_TURSO_DATABASE_URL || "";
  const base = raw.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  const enc = (v) =>
    v === null || v === undefined
      ? { type: "null", value: null }
      : typeof v === "number"
      ? Number.isInteger(v)
        ? { type: "integer", value: String(v) }
        : { type: "float", value: v }
      : { type: "text", value: String(v) };
  const dec = (c) => (!c || c.type === "null" ? null : c.type === "integer" || c.type === "float" ? Number(c.value) : c.value);
  const r = await fetch(base + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + (process.env.LOG_TURSO_AUTH_TOKEN || ""), "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: args.map(enc) } }, { type: "close" }] }),
  });
  const d = await r.json();
  const res = d.results && d.results[0];
  if (!res || res.type !== "ok") throw new Error("Turso: " + JSON.stringify(res?.error || d).slice(0, 200));
  const rr = res.response.result;
  return rr.rows.map((row) => Object.fromEntries(row.map((c, i) => [rr.cols[i].name, dec(c)])));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.LOG_TOKEN;
  if (token && (req.query?.key || "") !== token) {
    return res.status(401).json({ error: "no autorizado" });
  }
  if (!process.env.LOG_TURSO_DATABASE_URL) {
    return res.status(200).json({ conversaciones: [] });
  }

  try {
    const limite = Math.min(Math.max(Number(req.query?.limite) || 2000, 1), 5000);
    // Traemos los turnos más recientes; agrupamos por conversación en JS.
    const rows = await turso(
      'SELECT convId, negocio, agente, ts, model, userMsg, botMsg, inputTokens, outputTokens, cacheReadTokens, costUsd ' +
        'FROM "DemoChatLog" ORDER BY ts DESC LIMIT ?',
      [limite]
    );

    const porConv = new Map(); // preserva orden: primera aparición = más reciente
    for (const t of rows) {
      const key = t.convId || "sin-id";
      if (!porConv.has(key)) {
        porConv.set(key, { convId: key, negocio: t.negocio, agente: t.agente, totalUsd: 0, turnos: [] });
      }
      const c = porConv.get(key);
      c.turnos.push(t);
      c.totalUsd += t.costUsd || 0;
      if (!c.negocio && t.negocio) c.negocio = t.negocio;
    }

    const conversaciones = [...porConv.values()].map((c) => {
      c.turnos.sort((a, b) => String(a.ts).localeCompare(String(b.ts))); // cronológico dentro de la charla
      c.inicio = c.turnos[0]?.ts || null;
      c.fin = c.turnos[c.turnos.length - 1]?.ts || null;
      c.totalUsd = Math.round(c.totalUsd * 1e6) / 1e6;
      return c;
    });

    return res.status(200).json({ conversaciones });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error leyendo el registro" });
  }
}
