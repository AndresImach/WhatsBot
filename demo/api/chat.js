// Proxy serverless: recibe {system, messages, agente, cineId} del navegador y llama a Claude.
// La API key NUNCA sale al cliente: vive en la variable de entorno ANTHROPIC_API_KEY.
//
// Según "agente" se habilitan HERRAMIENTAS (tool use) y el servidor las ejecuta en un
// loop, devolviéndole el resultado al modelo hasta que produce la respuesta final:
//   - "cine"   → consultar_funcion (precio/disponibilidad reales de una función, API del cine)
//   - "tobias" → buscar_productos + crear_pedido (catálogo y pedidos reales en Turso)
//
// En Vercel (proyecto del demo): Settings → Environment Variables:
//   ANTHROPIC_API_KEY, y para Tobías: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
const CINE_API = "https://apiv2.gaf.adro.studio";
// Router de 2 capas: un clasificador barato decide quién atiende cada mensaje.
//   - MODEL_BARATO: atiende lo simple (catálogo, precios, horarios, pedidos normales). ~85%.
//   - MODEL_EXPERTO: solo lo que pide criterio (reclamos, pagos/entregas, temas delicados,
//     pedir hablar con una persona, ambigüedad). ~15%.
// El clasificador corre en el modelo barato y cuesta centavos.
const MODEL_BARATO = "claude-haiku-4-5";
const MODEL_EXPERTO = "claude-sonnet-4-6";
const MODEL_ROUTER = "claude-haiku-4-5";
const MAX_TOOL_ROUNDS = 5;

// ─────────────────────────── Herramientas: CINE ───────────────────────────
const TOOL_CONSULTAR_FUNCION = {
  name: "consultar_funcion",
  description:
    "Devuelve el PRECIO de las entradas y la DISPONIBILIDAD (butacas libres y vendidas) de una función puntual del cine, en tiempo real. " +
    "Usá el 'ref' y el 'formato' que figuran en la tabla interna de FUNCIONES de la cartelera. " +
    "Llamala cuando el usuario pregunte por precio, cuánto sale, o si quedan lugares para una función concreta.",
  input_schema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "El identificador 'ref' de la función (última columna de la tabla de FUNCIONES)." },
      formato: { type: "string", description: "Formato de la función: '2D' o '3D'." },
    },
    required: ["ref", "formato"],
  },
};

async function ejecutarConsultarFuncion(cineId, input) {
  const ref = String(input?.ref || "").trim();
  const formato = String(input?.formato || "2D").trim() || "2D";
  if (!ref) return JSON.stringify({ error: "Falta el 'ref' de la función." });
  try {
    const r = await fetch(`${CINE_API}/tickets/${cineId}/${encodeURIComponent(ref)}/${encodeURIComponent(formato)}`);
    const d = await r.json();
    if (d.status !== "ok") return JSON.stringify({ error: "No se encontró la función." });
    const precios = (d.tickets || []).map((t) => ({
      tipo: String(t.detalle || "").replace(/\*/g, "").trim() || "Entrada",
      precio: Number(t.precio),
    }));
    return JSON.stringify({
      pelicula: d.movie?.nombre,
      sala: d.movie?.sala,
      fechaHora: d.movie?.fechaHora?.date ? d.movie.fechaHora.date.slice(0, 16) : null,
      precios,
      disponibles: d.disponibles,
      vendidas: d.vendidas,
    });
  } catch (e) {
    return JSON.stringify({ error: "No se pudo consultar la función en este momento." });
  }
}

// ────────────────────── Turso (libSQL) por HTTP, sin dependencias ──────────────────────
function _tursoArg(v) {
  if (v === null || v === undefined) return { type: "null", value: null };
  if (typeof v === "number") {
    // libSQL distingue integer/float: los integer van como string (i64), los float como número (f64).
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

// ─────────────────────────── Herramientas: TOBIAS ───────────────────────────
const TOOL_BUSCAR_PRODUCTOS = {
  name: "buscar_productos",
  description:
    "Busca en el catálogo REAL de Tobías Distribuciones (insumos de repostería) por nombre y/o categoría. " +
    "Usala para: ver si venden un producto, saber su precio, o encontrar ALTERNATIVAS (buscando por categoría o palabra clave) cuando piden algo que no tienen. " +
    "Devuelve id, nombre, precio, categoría y si está disponible. NUNCA inventes productos ni precios: siempre salen de acá.",
  input_schema: {
    type: "object",
    properties: {
      texto: { type: "string", description: "Palabras clave del producto, ej: 'chocolate cobertura' o 'mermelada frutilla'." },
      categoria: { type: "string", description: "Nombre (o parte) de una categoría/rubro para filtrar o buscar alternativas, ej: 'HARINA'." },
      limite: { type: "integer", description: "Máximo de resultados (por defecto 8)." },
    },
  },
};

async function ejecutarBuscarProductos(input) {
  const texto = String(input?.texto || "").trim();
  const categoria = String(input?.categoria || "").trim();
  const limite = Math.min(Math.max(Number(input?.limite) || 8, 1), 15);
  if (!texto && !categoria) return JSON.stringify({ error: "Indicá 'texto' o 'categoria' para buscar." });
  try {
    let sql =
      'SELECT p.id, p.name, p.price, p.available, c.name AS categoria ' +
      'FROM "Product" p JOIN "Category" c ON c.id = p.categoryId WHERE p.price > 0';
    const args = [];
    if (texto) {
      for (const w of texto.split(/\s+/).slice(0, 6)) {
        sql += " AND p.name LIKE ?";
        args.push("%" + w + "%");
      }
    }
    if (categoria) {
      sql += " AND c.name LIKE ?";
      args.push("%" + categoria + "%");
    }
    sql += " ORDER BY p.available DESC, p.price ASC LIMIT ?";
    args.push(limite);
    const rows = await turso(sql, args);
    const resultados = rows.map((r) => ({
      id: r.id,
      nombre: r.name,
      precio: r.price,
      categoria: r.categoria,
      disponible: !!r.available,
    }));
    return JSON.stringify({ resultados, cantidad: resultados.length });
  } catch (e) {
    return JSON.stringify({ error: "No se pudo consultar el catálogo en este momento." });
  }
}

const TOOL_CREAR_PEDIDO = {
  name: "crear_pedido",
  description:
    "Registra un pedido en el sistema de Tobías con estado 'pendiente', para que una PERSONA lo confirme (no es una confirmación final; el bot no cobra ni cierra la venta). " +
    "Usá los 'id' de producto que devuelve buscar_productos. Confirmá con el cliente los items y su nombre antes de llamar. " +
    "Devuelve el número de pedido y el total calculado con precios reales.",
  input_schema: {
    type: "object",
    properties: {
      cliente_nombre: { type: "string", description: "Nombre del cliente." },
      cliente_telefono: { type: "string", description: "Teléfono del cliente (opcional)." },
      items: {
        type: "array",
        description: "Lista de productos pedidos.",
        items: {
          type: "object",
          properties: {
            producto_id: { type: "integer", description: "id del producto (de buscar_productos)." },
            cantidad: { type: "integer", description: "Cantidad pedida." },
          },
          required: ["producto_id", "cantidad"],
        },
      },
    },
    required: ["cliente_nombre", "items"],
  },
};

async function ejecutarCrearPedido(input) {
  const nombre = String(input?.cliente_nombre || "").trim();
  const telefono = String(input?.cliente_telefono || "").trim();
  const pedido = Array.isArray(input?.items) ? input.items : [];
  if (!nombre) return JSON.stringify({ error: "Falta el nombre del cliente." });
  if (!pedido.length) return JSON.stringify({ error: "El pedido no tiene items." });
  try {
    // Traemos los productos reales (id → fila + categoría) y armamos el JSON como la web.
    const ids = [...new Set(pedido.map((i) => Number(i.producto_id)).filter(Boolean))];
    if (!ids.length) return JSON.stringify({ error: "Ningún producto_id válido." });
    const placeholders = ids.map(() => "?").join(",");
    const prods = await turso(
      `SELECT p.*, c.id AS c_id, c.name AS c_name, c.slug AS c_slug, c.emoji AS c_emoji, c."order" AS c_order, c.createdAt AS c_createdAt ` +
        `FROM "Product" p JOIN "Category" c ON c.id = p.categoryId WHERE p.id IN (${placeholders})`,
      ids
    );
    const porId = Object.fromEntries(prods.map((p) => [p.id, p]));

    const items = [];
    let total = 0;
    for (const it of pedido) {
      const p = porId[Number(it.producto_id)];
      const cantidad = Math.max(Number(it.cantidad) || 0, 0);
      if (!p || !cantidad) continue;
      total += p.price * cantidad;
      const { c_id, c_name, c_slug, c_emoji, c_order, c_createdAt, ...prod } = p;
      prod.available = !!prod.available;
      prod.featured = !!prod.featured;
      prod.category = { id: c_id, name: c_name, slug: c_slug, emoji: c_emoji, order: c_order, createdAt: c_createdAt };
      prod.borgestProduct = null;
      items.push({ product: prod, quantity: cantidad });
    }
    if (!items.length) return JSON.stringify({ error: "No se pudo armar el pedido con esos productos." });
    total = Math.round(total * 100) / 100;

    await turso(
      'INSERT INTO "Order" (customerName, phone, items, total, status, source) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, telefono, JSON.stringify(items), total, "pending", "whatsapp"]
    );
    const nuevo = await turso('SELECT id FROM "Order" ORDER BY id DESC LIMIT 1');
    return JSON.stringify({
      ok: true,
      pedido_id: nuevo[0]?.id ?? null,
      estado: "pendiente de confirmación por una persona",
      total,
      resumen: items.map((i) => ({ producto: i.product.name, cantidad: i.quantity, precio_unitario: i.product.price })),
    });
  } catch (e) {
    return JSON.stringify({ error: "No se pudo registrar el pedido en este momento." });
  }
}

// ─────────────────────────── Selección y dispatch ───────────────────────────
function toolsPara(agente, cineId) {
  if (agente === "cine" && cineId) return [TOOL_CONSULTAR_FUNCION];
  if (agente === "tobias") return [TOOL_BUSCAR_PRODUCTOS, TOOL_CREAR_PEDIDO];
  return undefined;
}
async function ejecutarTool(name, input, ctx) {
  if (name === "consultar_funcion") return ejecutarConsultarFuncion(ctx.cineId, input);
  if (name === "buscar_productos") return ejecutarBuscarProductos(input);
  if (name === "crear_pedido") return ejecutarCrearPedido(input);
  return JSON.stringify({ error: "Herramienta desconocida." });
}

async function llamarClaude({ system, messages, tools, model, maxTokens }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || MODEL_EXPERTO,
      max_tokens: maxTokens || 1000,
      system: system || "",
      messages,
      ...(tools ? { tools } : {}),
    }),
  });
  return { status: r.status, data: await r.json() };
}

// Router: clasifica el último mensaje del cliente y elige el modelo que lo atiende.
// Corre en el modelo barato mirando solo los últimos turnos (texto), así cuesta muy poco.
// Ante cualquier duda o error, escala al modelo experto (prioriza calidad sobre costo).
async function elegirModelo(messages) {
  const ultimos = (messages || [])
    .slice(-6)
    .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
    .filter((m) => m.content);
  if (!ultimos.length) return MODEL_BARATO;

  const instruccion =
    "Sos un clasificador. Mirá el ÚLTIMO mensaje del cliente en esta conversación y decidí quién debe atenderlo:\n" +
    "- 'simple': consultas de información, catálogo, productos, precios, horarios, cartelera, disponibilidad, o un pedido/compra normal, saludos y charla común.\n" +
    "- 'experto': reclamos o quejas, un problema con un pago, compra o entrega, temas delicados o sensibles, pedidos de hablar con una persona, o situaciones ambiguas que requieran criterio.\n" +
    "Respondé SOLO con una palabra, en minúscula: simple o experto.";
  try {
    const { status, data } = await llamarClaude({
      system: instruccion,
      messages: ultimos,
      model: MODEL_ROUTER,
      maxTokens: 5,
    });
    if (status !== 200) return MODEL_EXPERTO;
    const txt = (data.content || [])
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join(" ")
      .toLowerCase();
    return txt.includes("experto") ? MODEL_EXPERTO : MODEL_BARATO;
  } catch {
    return MODEL_EXPERTO;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { system, messages, agente, cineId } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages es requerido" });
    }

    const tools = toolsPara(agente, cineId);
    const ctx = { cineId };
    const convo = messages.slice();

    // Router: elegimos el modelo según la dificultad del último mensaje.
    const model = await elegirModelo(messages);

    // Loop de herramientas: sin tools, sale en la 1ª vuelta.
    for (let ronda = 0; ronda <= MAX_TOOL_ROUNDS; ronda++) {
      const { status, data } = await llamarClaude({ system, messages: convo, tools, model });
      if (status !== 200) return res.status(status).json(data);
      if (data.stop_reason !== "tool_use") return res.status(200).json(data);

      convo.push({ role: "assistant", content: data.content });
      const resultados = [];
      for (const bloque of data.content) {
        if (bloque.type === "tool_use") {
          const out = await ejecutarTool(bloque.name, bloque.input, ctx);
          resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: out });
        }
      }
      convo.push({ role: "user", content: resultados });
    }

    // Se agotaron las rondas: respuesta final sin herramientas.
    const { status, data } = await llamarClaude({ system, messages: convo, model });
    return res.status(status).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno del proxy" });
  }
}
