// Proxy serverless: recibe {system, messages, agente, cineId} del navegador y llama a Claude.
// La API key NUNCA sale al cliente: vive en la variable de entorno ANTHROPIC_API_KEY.
//
// Según "agente" se habilitan HERRAMIENTAS (tool use) y el servidor las ejecuta en un
// loop, devolviéndole el resultado al modelo hasta que produce la respuesta final:
//   - "cine"   → consultar_funcion (precio/disponibilidad reales de una función, API del cine)
//   - "tobias" → buscar_producto + verificar_disponibilidad + registrar_pedido
//                (catálogo, disponibilidad y pedidos reales en Turso)
//   - "pwa"    → crear_pedido (el catálogo NO es una tool: se trae una sola vez por
//                conversación en api/catalogo.js y se inyecta en el prompt del sistema,
//                ver negocios.js. Evita que cada turno dispare una ronda extra sin caché.)
//
// PROMPT CACHING: el prompt del sistema es SOLO contextual (personalidad, reglas,
// flujos). El esquema de la base y las credenciales viven acá, no en el prompt.
// Hay DOS breakpoints de caché por request:
//   1) al final del system → cachea el prefijo estable (tools + system).
//   2) al final del ÚLTIMO mensaje de la conversación → cachea también el historial
//      acumulado (incluidos resultados de tools de rondas anteriores), que es lo que
//      realmente crece dentro de un mismo turno (loop de herramientas) y entre turnos.
// CONTROL DE COSTOS ADICIONAL:
//   - buscar_producto devuelve menos resultados por defecto (se reenvían en cada ronda
//     siguiente del loop, así que menos filas = menos tokens repetidos).
//   - registrar_pedido valida disponibilidad en tiempo real él mismo (relee la fila fresca
//     de la base), así que verificar_disponibilidad es opcional para el modelo y no un
//     paso obligatorio que agregue una ronda extra por pedido.
//   - el historial de la conversación tiene un techo defensivo (podarHistorial) para
//     que una sesión de demo muy larga no crezca sin límite.
//
// En Vercel (proyecto del demo): Settings → Environment Variables:
//   ANTHROPIC_API_KEY
//   Para Tobías: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN (catálogo/pedidos reales)
//   Para el registro de conversaciones del demo (base APARTE, no la de Tobías):
//     LOG_TURSO_DATABASE_URL, LOG_TURSO_AUTH_TOKEN
import { upsertConversacion, getConversacion, setEstado, agregarMensaje } from "../lib/db.js";

const CINE_API = "https://apiv2.gaf.adro.studio";
// Mensaje por defecto cuando se deriva a una persona y el negocio (negocios.js)
// no mandó uno propio en "derivacion".
const DERIVACION_DEFAULT = "Dame un segundo que te paso con una persona 🙌";
// La persistencia de conversaciones (pivot a humano + backoffice) usa la misma
// base LOG_TURSO de los logs de costo. Si no está configurada, el demo sigue
// funcionando exactamente como antes (sin pausa ni backoffice).
const persistenciaActiva = () => !!process.env.LOG_TURSO_DATABASE_URL;
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
async function _turso(rawUrl, authToken, sql, args = []) {
  const base = (rawUrl || "").replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  const r = await fetch(base + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + (authToken || ""), "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: args.map(_tursoArg) } }, { type: "close" }] }),
  });
  const d = await r.json();
  const res = d.results && d.results[0];
  if (!res || res.type !== "ok") throw new Error("Turso: " + JSON.stringify(res?.error || d).slice(0, 200));
  const rr = res.response.result;
  return rr.rows.map((row) => Object.fromEntries(row.map((c, i) => [rr.cols[i].name, _decode(c)])));
}

// Base de datos de Tobías (catálogo y pedidos).
function turso(sql, args = []) {
  return _turso(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN, sql, args);
}
// Base de datos SEPARADA solo para el registro de conversaciones del demo
// (no vive en la base de Tobías ni en la de ningún cliente).
function tursoLogs(sql, args = []) {
  return _turso(process.env.LOG_TURSO_DATABASE_URL, process.env.LOG_TURSO_AUTH_TOKEN, sql, args);
}

// ─────────────────────────── Herramientas: TOBIAS ───────────────────────────
const TOOL_BUSCAR_PRODUCTO = {
  name: "buscar_producto",
  description:
    "Busca en el catálogo REAL de Tobías Distribuciones (insumos de repostería) por nombre y/o categoría. " +
    "Usala para: ver si venden un producto, saber su precio, o encontrar ALTERNATIVAS (buscando por categoría o palabra clave) cuando piden algo que no tienen. " +
    "Devuelve id, nombre, precio, categoría y si está disponible. NUNCA inventes productos ni precios: siempre salen de acá.",
  input_schema: {
    type: "object",
    properties: {
      texto: { type: "string", description: "Palabras clave del producto, ej: 'chocolate cobertura' o 'mermelada frutilla'." },
      categoria: { type: "string", description: "Nombre (o parte) de una categoría/rubro para filtrar o buscar alternativas, ej: 'HARINA'." },
      limite: { type: "integer", description: "Máximo de resultados (por defecto 5, máximo 8). Pedí pocos: se reenvían en cada ronda siguiente de la conversación." },
    },
  },
};

// Quita tildes y pasa a minúsculas para comparar texto de usuario contra el catálogo.
// SQLite (y libSQL) foldea mayúsculas/minúsculas ASCII con LOWER(), pero NO acentos:
// "AZÚCAR" no matchea LIKE '%azucar%'. Sin esto, cualquier búsqueda sin tilde (lo más
// común escribiendo desde WhatsApp) falla en silencio y el modelo tiene que reintentar
// con otro llamado completo — un round-trip entero (con todo el contexto reenviado)
// solo para "buscar de nuevo lo mismo".
function normalizarTexto(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
// Mismo pliegue de acentos aplicado a la columna en SQL (no hay función unaccent nativa;
// alcanza con las 6 vocales/ñ acentuadas del español). Solo envuelve nombres de columna
// fijos, nunca input del usuario, así que es seguro concatenarlo directo en el SQL.
const SQL_SIN_ACENTOS = (col) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${col}),'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ñ','n')`;

// Límites bajos a propósito: cada resultado que devuelve esta tool se reenvía de nuevo
// en las rondas siguientes del loop (y en el resto del turno), así que menos filas =
// menos tokens repetidos. 5-8 alcanza para que el modelo elija u ofrezca alternativas.
async function ejecutarBuscarProducto(input) {
  const texto = String(input?.texto || "").trim();
  const categoria = String(input?.categoria || "").trim();
  const limite = Math.min(Math.max(Number(input?.limite) || 5, 1), 8);
  if (!texto && !categoria) return JSON.stringify({ error: "Indicá 'texto' o 'categoria' para buscar." });
  try {
    const palabras = texto ? normalizarTexto(texto).split(/\s+/).filter(Boolean).slice(0, 6) : [];
    const catNorm = categoria ? normalizarTexto(categoria) : "";

    const base =
      'SELECT p.id, p.name, p.price, p.available, c.name AS categoria ' +
      'FROM "Product" p JOIN "Category" c ON c.id = p.categoryId WHERE p.price > 0';
    const condCategoria = categoria ? ` AND ${SQL_SIN_ACENTOS("c.name")} LIKE ?` : "";
    const argsCategoria = categoria ? ["%" + catNorm + "%"] : [];

    async function buscar(modo) {
      // modo "AND": tienen que estar todas las palabras (más preciso). "OR": alcanza con una.
      const condsPalabras = palabras.map(() => `${SQL_SIN_ACENTOS("p.name")} LIKE ?`);
      const argsPalabras = palabras.map((w) => "%" + w + "%");
      const condPalabras = condsPalabras.length
        ? " AND (" + condsPalabras.join(modo === "AND" ? " AND " : " OR ") + ")"
        : "";
      const sql = base + condPalabras + condCategoria + " ORDER BY p.available DESC, p.price ASC LIMIT ?";
      return turso(sql, [...argsPalabras, ...argsCategoria, limite]);
    }

    // Primero exigimos todas las palabras (más preciso). Si no hay resultados y había
    // más de una palabra, relajamos a "alguna palabra" ANTES de devolver vacío: una
    // palabra de más (marca, cantidad, adjetivo) no debería tirar toda la búsqueda a
    // cero y forzar al modelo a gastar otro llamado completo reintentando distinto.
    let rows = await buscar("AND");
    if (!rows.length && palabras.length > 1) {
      rows = await buscar("OR");
    }

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

// verificar_disponibilidad: chequea un producto puntual por id, para cuando el cliente
// pregunta explícitamente por stock antes de decidir. NO es un paso obligatorio antes de
// registrar_pedido: esa tool ya relee la disponibilidad fresca de la base ella misma, así
// que usar esta acá solo cuando agrega valor evita una ronda extra (y su reenvío de
// contexto) en el camino común de un pedido.
// El esquema real solo tiene un booleano 'available' (no hay stock numérico), así que
// devuelve disponible/no-disponible + el precio vigente.
const TOOL_VERIFICAR_DISPONIBILIDAD = {
  name: "verificar_disponibilidad",
  description:
    "Verifica, por su 'id' (de buscar_producto), si un producto puntual está DISPONIBLE para vender y a qué PRECIO vigente. " +
    "Usala solo cuando el cliente pregunta explícitamente por stock/disponibilidad ANTES de decidir el pedido. " +
    "NO hace falta llamarla como paso previo a registrar_pedido: esa tool ya valida disponibilidad ella misma con datos frescos.",
  input_schema: {
    type: "object",
    properties: {
      producto_id: { type: "integer", description: "id del producto (de buscar_producto)." },
      cantidad: { type: "integer", description: "Cantidad que quiere el cliente." },
    },
    required: ["producto_id", "cantidad"],
  },
};

async function ejecutarVerificarDisponibilidad(input) {
  const id = Number(input?.producto_id);
  const cantidad = Math.max(Number(input?.cantidad) || 1, 1);
  if (!id) return JSON.stringify({ error: "Falta un 'producto_id' válido." });
  try {
    const rows = await turso(
      'SELECT p.id, p.name, p.price, p.available, c.name AS categoria ' +
        'FROM "Product" p JOIN "Category" c ON c.id = p.categoryId WHERE p.id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) return JSON.stringify({ error: "No existe ese producto_id.", producto_id: id });
    const p = rows[0];
    // Solo datos necesarios (compacto para no inflar tokens de entrada).
    return JSON.stringify({
      id: p.id,
      nombre: p.name,
      precio: p.price,
      categoria: p.categoria,
      cantidad_solicitada: cantidad,
      disponible: !!p.available && p.price > 0,
    });
  } catch (e) {
    return JSON.stringify({ error: "No se pudo verificar la disponibilidad en este momento." });
  }
}

const TOOL_REGISTRAR_PEDIDO = {
  name: "registrar_pedido",
  description:
    "Registra un pedido en el sistema de Tobías con estado 'pendiente', para que una PERSONA lo confirme (no es una confirmación final; el bot no cobra ni cierra la venta). " +
    "Usá los 'id' de producto que devolvió buscar_producto, y copiá su 'nombre' EXACTO en 'nombre_esperado' de cada item (se usa para verificar que el id coincide con lo que le mostraste al cliente; si no coincide, la tool RECHAZA todo el pedido). " +
    "Confirmá con el cliente los items y su nombre antes de llamar. " +
    "Es TODO O NADA: si algún item no existe, no está disponible, o el nombre no coincide con 'nombre_esperado', NO registra nada y te devuelve el detalle para que lo corrijas o vuelvas a buscar. " +
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
            producto_id: { type: "integer", description: "id del producto (de buscar_producto)." },
            nombre_esperado: { type: "string", description: "El 'nombre' que devolvió buscar_producto para ese id. Se valida contra la base antes de registrar." },
            cantidad: { type: "integer", description: "Cantidad pedida." },
          },
          required: ["producto_id", "nombre_esperado", "cantidad"],
        },
      },
    },
    required: ["cliente_nombre", "items"],
  },
};

// Compara el nombre que el modelo dice esperar contra el nombre real en la base.
// Heurística tolerante a formato (mayúsculas, tildes, "X 380 GR" vs "x380gr"), pero que
// SÍ detecta un id equivocado: exige que compartan al menos una palabra significativa
// (≥4 letras, sin unidades/números). Esto es lo que hubiera atajado el bug real: un
// producto_id que resolvía a "MERMELADA..." cuando el modelo esperaba un "PIROTIN...".
function _normalizar(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // saca tildes
}
const _UNIDADES = new Set(["GR", "KG", "ML", "LTS", "UNI", "UND", "PACK", "CAJA", "SIN", "CON"]);
function _palabrasClave(s) {
  return _normalizar(s)
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !_UNIDADES.has(w));
}
function nombreCoincide(esperado, real) {
  if (!esperado) return true; // si no lo mandó, no bloqueamos (compatibilidad hacia atrás)
  const a = new Set(_palabrasClave(esperado));
  const b = new Set(_palabrasClave(real));
  for (const w of a) if (b.has(w)) return true;
  return a.size === 0; // nombre_esperado sin palabras clave: no podemos validar, dejamos pasar
}

async function ejecutarRegistrarPedido(input) {
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

    // TODO O NADA: si CUALQUIER item falla (id inexistente, no disponible, o el nombre
    // no coincide con lo que el modelo dice haber mostrado), se rechaza el pedido ENTERO.
    // Antes esto solo excluía el item problemático y registraba el resto igual — así fue
    // como un producto_id equivocado terminó armando un pedido real con un producto
    // totalmente distinto al que se le había cotizado al cliente.
    const problemas = [];
    const items = [];
    let total = 0;
    for (const it of pedido) {
      const idNum = Number(it.producto_id);
      const cantidad = Math.max(Number(it.cantidad) || 0, 0);
      const p = porId[idNum];
      if (!p) {
        problemas.push({ producto_id: idNum, motivo: "no existe ese producto_id", nombre_esperado: it.nombre_esperado || null });
        continue;
      }
      if (!cantidad) {
        problemas.push({ producto_id: idNum, motivo: "cantidad inválida" });
        continue;
      }
      if (!nombreCoincide(it.nombre_esperado, p.name)) {
        problemas.push({
          producto_id: idNum,
          motivo: "el nombre_esperado no coincide con el producto real de ese id — probable id equivocado",
          nombre_esperado: it.nombre_esperado,
          nombre_real_en_base: p.name,
        });
        continue;
      }
      if (!p.available || !(p.price > 0)) {
        problemas.push({ producto_id: idNum, motivo: "no disponible", nombre: p.name });
        continue;
      }
      total += p.price * cantidad;
      const { c_id, c_name, c_slug, c_emoji, c_order, c_createdAt, ...prod } = p;
      prod.available = !!prod.available;
      prod.featured = !!prod.featured;
      prod.category = { id: c_id, name: c_name, slug: c_slug, emoji: c_emoji, order: c_order, createdAt: c_createdAt };
      prod.borgestProduct = null;
      items.push({ product: prod, quantity: cantidad });
    }
    if (problemas.length) {
      // No se registra NADA si hubo cualquier problema — evita pedidos parciales/erróneos.
      return JSON.stringify({
        error: "No se registró el pedido: hay items con problemas. Volvé a buscarlos con buscar_producto y corregí antes de reintentar.",
        problemas,
      });
    }
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

// ─────────────────────────── Herramientas: PWA de pedidos ───────────────────────────
// El agente "pwa" NO usa la base de Tobías: le habla por HTTP a la PWA de mostrador
// (carpeta pedidos/) con el token del bot. El catálogo y los pedidos viven allá, así
// que el carnicero ve el pedido en su pantalla apenas el bot lo registra.
const PEDIDOS_API_URL = (process.env.PEDIDOS_API_URL || "").replace(/\/$/, "");

async function pwaFetch(path, opts = {}) {
  const r = await fetch(PEDIDOS_API_URL + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (process.env.PEDIDOS_API_TOKEN || ""),
      ...(opts.headers || {}),
    },
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const TOOL_CREAR_PEDIDO = {
  name: "crear_pedido",
  description:
    "Registra el pedido en el sistema del local con estado PENDIENTE, para que una PERSONA lo confirme desde la app del mostrador. " +
    "NO es una confirmación final: el bot no cierra la venta ni cobra; el carnicero revisa disponibilidad y confirma. " +
    "Confirmá los ítems y cantidades con el cliente ANTES de llamar. En cada ítem copiá el 'nombre' y la 'unidad' EXACTOS del catálogo del prompt, " +
    "y poné su 'id' en 'catalogo_item_id'. Devuelve el número de pedido.",
  input_schema: {
    type: "object",
    properties: {
      cliente_nombre: { type: "string", description: "Nombre del cliente." },
      cliente_telefono: { type: "string", description: "Teléfono del cliente (opcional)." },
      nota: { type: "string", description: "Comentario opcional del cliente (ej: horario de retiro)." },
      items: {
        type: "array",
        description: "Productos pedidos.",
        items: {
          type: "object",
          properties: {
            catalogo_item_id: { type: "integer", description: "id del producto (del catálogo del prompt). Omitilo solo si es un producto suelto que no está en el catálogo." },
            nombre: { type: "string", description: "Nombre del producto, igual al del catálogo del prompt." },
            cantidad_pedida: { type: "number", description: "Cantidad pedida (ej: 1, 3, 500)." },
            unidad: { type: "string", description: "Unidad: 'kg', 'g' o 'unidad', igual a la del catálogo." },
          },
          required: ["nombre", "cantidad_pedida", "unidad"],
        },
      },
    },
    required: ["cliente_nombre", "items"],
  },
};

async function ejecutarCrearPedido(input) {
  if (!PEDIDOS_API_URL) return JSON.stringify({ error: "La app de pedidos no está configurada (falta PEDIDOS_API_URL)." });
  const nombre = String(input?.cliente_nombre || "").trim();
  const items = Array.isArray(input?.items) ? input.items : [];
  if (!nombre) return JSON.stringify({ error: "Falta el nombre del cliente." });
  if (!items.length) return JSON.stringify({ error: "El pedido no tiene ítems." });
  for (const it of items) {
    if (!it?.nombre || !(Number(it.cantidad_pedida) > 0)) {
      return JSON.stringify({ error: "Cada ítem necesita 'nombre' y 'cantidad_pedida' mayor a 0." });
    }
  }
  try {
    const { status, data } = await pwaFetch("/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        cliente_nombre: nombre,
        cliente_telefono: String(input?.cliente_telefono || "").trim() || null,
        nota: String(input?.nota || "").trim() || null,
        items: items.map((it) => ({
          catalogo_item_id: it.catalogo_item_id ?? null,
          nombre: String(it.nombre),
          cantidad_pedida: Number(it.cantidad_pedida),
          unidad: it.unidad || "unidad",
        })),
      }),
    });
    if (status === 201 && data.pedido) {
      return JSON.stringify({
        ok: true,
        pedido_id: data.pedido.id,
        estado: "pendiente de confirmación por una persona del local",
        resumen: (data.pedido.items || []).map((i) => ({ producto: i.nombre, cantidad: i.cantidad_pedida, unidad: i.unidad })),
      });
    }
    return JSON.stringify({ error: data.error || "No se pudo registrar el pedido." });
  } catch (e) {
    return JSON.stringify({ error: "No se pudo registrar el pedido en este momento." });
  }
}

// ─────────────────────────── Selección y dispatch ───────────────────────────
// El orden de las tools es FIJO: forma parte del prefijo cacheado (tools → system).
// Reordenarlas invalidaría el caché, así que se mantienen como literal estable.
function toolsPara(agente, cineId) {
  if (agente === "cine" && cineId) return [TOOL_CONSULTAR_FUNCION];
  if (agente === "tobias") return [TOOL_BUSCAR_PRODUCTO, TOOL_VERIFICAR_DISPONIBILIDAD, TOOL_REGISTRAR_PEDIDO];
  if (agente === "pwa") return [TOOL_CREAR_PEDIDO];
  return undefined;
}
async function ejecutarTool(name, input, ctx) {
  if (name === "consultar_funcion") return ejecutarConsultarFuncion(ctx.cineId, input);
  if (name === "buscar_producto") return ejecutarBuscarProducto(input);
  if (name === "verificar_disponibilidad") return ejecutarVerificarDisponibilidad(input);
  if (name === "registrar_pedido") return ejecutarRegistrarPedido(input);
  if (name === "crear_pedido") return ejecutarCrearPedido(input);
  return JSON.stringify({ error: "Herramienta desconocida." });
}

// Prompt caching: con cache=true, el prompt del sistema se manda como un bloque de
// texto con cache_control ephemeral. El orden de render es tools → system, así que un
// solo breakpoint al final del system cachea TODO el prefijo estable (tools + system).
// Ese prefijo se reusa en cada ronda del loop de herramientas y en cada turno de la
// conversación (caché de 5 min), en vez de reprocesarse como "no_cache" cada vez.
//   Nota: en Haiku 4.5 el mínimo cacheable es ~4096 tokens. Si el prefijo es más corto
//   (p. ej. Tobías sin cartelera), simplemente no se escribe caché: no hay error ni
//   costo extra, y el ahorro aparece solo cuando el prefijo supera ese umbral
//   (cine con cartelera, o conversaciones largas).
function armarSystem(system, cache) {
  const txt = system || "";
  if (!cache || !txt) return txt;
  return [{ type: "text", text: txt, cache_control: { type: "ephemeral" } }];
}

// Segundo breakpoint: al final del ÚLTIMO mensaje de la conversación. Esto es lo que
// más importa en la práctica: el loop de herramientas reenvía TODA la conversación
// (incluidos resultados de tools de rondas anteriores) en cada ronda, y cada turno
// reenvía todo el historial. Con este marker, la ronda/turno siguiente lee ese prefijo
// a ~0.1x en vez de precio completo, en vez de solo cachear el system+tools (que en
// Tobías casi nunca llega al mínimo cacheable por sí solo).
// cache_control solo puede ir en un content block, no en un string plano: si el último
// mensaje tiene content string se lo envuelve en un bloque de texto.
function conCacheEnUltimoMensaje(messages) {
  if (!messages || !messages.length) return messages;
  const ultimo = messages[messages.length - 1];
  const content =
    typeof ultimo.content === "string"
      ? [{ type: "text", text: ultimo.content }]
      : ultimo.content.map((b) => ({ ...b }));
  if (!content.length) return messages;
  content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: "ephemeral" } };
  return [...messages.slice(0, -1), { role: ultimo.role, content }];
}

async function llamarClaude({ system, messages, tools, model, maxTokens, cache = false }) {
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
      system: armarSystem(system, cache),
      messages: cache ? conCacheEnUltimoMensaje(messages) : messages,
      ...(tools ? { tools } : {}),
    }),
  });
  return { status: r.status, data: await r.json() };
}

// Router: clasifica el último mensaje del cliente en 3 categorías.
// Corre en el modelo barato mirando solo los últimos turnos (texto), así cuesta muy poco.
// Ante cualquier duda o error, escala al modelo experto (prioriza calidad sobre costo);
// 'derivar' solo se usa cuando hace explícitamente falta una persona (nunca por duda).
async function clasificar(messages) {
  const ultimos = (messages || [])
    .slice(-6)
    .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
    .filter((m) => m.content);
  if (!ultimos.length) return { categoria: "simple", usage: {} };

  const instruccion =
    "Sos un clasificador. Mirá el ÚLTIMO mensaje del cliente en esta conversación y decidí la categoría:\n" +
    "- 'simple': consultas de información, catálogo, productos, precios, horarios, cartelera, disponibilidad, o un pedido/compra normal, saludos y charla común.\n" +
    "- 'experto': temas delicados o sensibles, o situaciones ambiguas que requieran criterio, pero que el negocio puede seguir resolviendo él mismo.\n" +
    "- 'derivar': una queja o reclamo, un problema con un pago/compra/entrega, o un pedido EXPLÍCITO de hablar con una persona.\n" +
    "Respondé SOLO con una palabra, en minúscula: simple, experto o derivar.";
  try {
    const { status, data } = await llamarClaude({
      system: instruccion,
      messages: ultimos,
      model: MODEL_ROUTER,
      maxTokens: 5,
    });
    if (status !== 200) return { categoria: "experto", usage: {} };
    const txt = (data.content || [])
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join(" ")
      .toLowerCase();
    const categoria = txt.includes("derivar") ? "derivar" : txt.includes("experto") ? "experto" : "simple";
    return { categoria, usage: data.usage || {} };
  } catch {
    return { categoria: "experto", usage: {} };
  }
}

// ─────────────────────────── Costos y registro ───────────────────────────
// Precios por millón de tokens (USD). El cache read se cobra ~10× más barato.
const PRECIOS = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};
function costoUsd(model, usage) {
  const p = PRECIOS[model] || PRECIOS[MODEL_EXPERTO];
  const inNoCache = usage.input_tokens || 0;
  // Escritura de caché (~1.25x) y lectura (~0.1x): ambas hay que sumarlas o el costo
  // logueado queda subestimado apenas el caché empieza a escribir.
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (inNoCache * p.in + cacheWrite * p.in * 1.25 + cacheRead * p.in * 0.1 + out * p.out) / 1e6;
}
function sumarUsage(acc, usage) {
  acc.input_tokens += usage?.input_tokens || 0;
  acc.output_tokens += usage?.output_tokens || 0;
  acc.cache_read_input_tokens += usage?.cache_read_input_tokens || 0;
  acc.cache_creation_input_tokens += usage?.cache_creation_input_tokens || 0;
}

// Guarda un resumen del turno en la base SEPARADA de logs (no la de Tobías). Best-effort: nunca rompe la respuesta.
async function registrarLog(rec) {
  if (!process.env.LOG_TURSO_DATABASE_URL) return;
  try {
    await tursoLogs(
      'INSERT INTO "DemoChatLog" (convId, negocio, agente, model, userMsg, botMsg, inputTokens, outputTokens, cacheReadTokens, costUsd) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        rec.convId || null,
        rec.negocio || null,
        rec.agente || null,
        rec.model || null,
        rec.userMsg || null,
        rec.botMsg || null,
        rec.inputTokens || 0,
        rec.outputTokens || 0,
        rec.cacheReadTokens || 0,
        rec.costUsd || 0,
      ]
    );
  } catch (e) {
    console.error("log:", e.message);
  }
}

function textoDe(content) {
  return (content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
function ultimoMensajeUsuario(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && typeof messages[i].content === "string") return messages[i].content;
  }
  return "";
}

// Techo defensivo: en una sesión de demo excepcionalmente larga, evita reenviar un
// historial que crece sin límite (costo y, eventualmente, la ventana de contexto).
// No afecta conversaciones normales (bien por debajo del límite). Corta buscando el
// próximo mensaje de rol "user" para no romper la regla de que el primer mensaje
// enviado a la API debe ser "user".
const MAX_HISTORIAL = 40;
function podarHistorial(messages) {
  if (messages.length <= MAX_HISTORIAL) return messages.slice();
  let corte = messages.length - MAX_HISTORIAL;
  while (corte < messages.length && messages[corte].role !== "user") corte++;
  return messages.slice(corte);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { system, messages, agente, cineId, convId, negocio, derivacion } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages es requerido" });
    }

    // Persistencia + pivot a humano: guardamos el mensaje del cliente y nos
    // fijamos si esta conversación ya la tomó una persona desde el backoffice.
    // Si no hay LOG_TURSO configurada, esto se salta entero y el demo se
    // comporta exactamente como antes (sin pausa ni backoffice).
    let conv = null;
    let ultimoId = null;
    if (convId && persistenciaActiva()) {
      try {
        await upsertConversacion(convId, negocio);
        ultimoId = await agregarMensaje(convId, "user", ultimoMensajeUsuario(messages));
        conv = await getConversacion(convId);
      } catch (e) {
        console.error("db:", e.message);
      }
    }
    if (conv?.estado === "humano") {
      // Una persona ya está atendiendo: no contesta el bot, solo queda registrado.
      return res.status(200).json({ paused: true, ultimoId });
    }

    const tools = toolsPara(agente, cineId);
    const ctx = { cineId };
    const convo = podarHistorial(messages);

    // Router: elegimos la categoría del último mensaje (y con ella, el modelo).
    const { categoria, usage: routerUsage } = await clasificar(messages);

    if (categoria === "derivar") {
      // No hace falta gastar en el modelo principal: derivamos directo,
      // igual que haría el bot real (bot/lib/router.js) ante un "derivar".
      const texto = derivacion || DERIVACION_DEFAULT;
      if (convId && persistenciaActiva()) {
        try {
          await setEstado(convId, "humano");
          ultimoId = await agregarMensaje(convId, "assistant", texto);
        } catch (e) {
          console.error("db:", e.message);
        }
      }
      registrarLog({
        convId,
        negocio,
        agente,
        model: "derivar",
        userMsg: ultimoMensajeUsuario(messages),
        botMsg: texto,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costUsd: Math.round(costoUsd(MODEL_ROUTER, routerUsage) * 1e6) / 1e6,
      });
      return res.status(200).json({ content: [{ type: "text", text: texto }], derivar: true, ultimoId });
    }

    const model = categoria === "experto" ? MODEL_EXPERTO : MODEL_BARATO;

    // Acumulamos el consumo del handler a lo largo del loop para el log de costos.
    const handlerUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let finalData = null;
    let finalStatus = 200;

    // Loop de herramientas: sin tools, sale en la 1ª vuelta.
    for (let ronda = 0; ronda <= MAX_TOOL_ROUNDS; ronda++) {
      const { status, data } = await llamarClaude({ system, messages: convo, tools, model, cache: true });
      if (status !== 200) return res.status(status).json(data);
      sumarUsage(handlerUsage, data.usage);
      if (data.stop_reason !== "tool_use") {
        finalData = data;
        finalStatus = status;
        break;
      }

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
    if (!finalData) {
      const { status, data } = await llamarClaude({ system, messages: convo, model, cache: true });
      if (status !== 200) return res.status(status).json(data);
      sumarUsage(handlerUsage, data.usage);
      finalData = data;
      finalStatus = status;
    }

    if (convId && persistenciaActiva()) {
      try {
        await agregarMensaje(convId, "assistant", textoDe(finalData.content));
      } catch (e) {
        console.error("db:", e.message);
      }
    }

    // Registro del turno (costo = handler + router). No bloquea la respuesta.
    const costoTurno = costoUsd(model, handlerUsage) + costoUsd(MODEL_ROUTER, routerUsage);
    registrarLog({
      convId,
      negocio,
      agente,
      model,
      userMsg: ultimoMensajeUsuario(messages),
      botMsg: textoDe(finalData.content),
      inputTokens: handlerUsage.input_tokens,
      outputTokens: handlerUsage.output_tokens,
      cacheReadTokens: handlerUsage.cache_read_input_tokens,
      costUsd: Math.round(costoTurno * 1e6) / 1e6,
    });

    return res.status(finalStatus).json(finalData);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno del proxy" });
  }
}
