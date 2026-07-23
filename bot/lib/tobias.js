function tursoArg(valor) {
  if (valor === null || valor === undefined) return { type: "null", value: null };
  if (typeof valor === "number") {
    return Number.isInteger(valor)
      ? { type: "integer", value: String(valor) }
      : { type: "float", value: valor };
  }
  return { type: "text", value: String(valor) };
}

function decodificar(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer" || cell.type === "float") return Number(cell.value);
  return cell.value;
}

async function turso(sql, args = []) {
  const base = String(process.env.TURSO_DATABASE_URL || "")
    .replace(/^libsql:\/\//, "https://")
    .replace(/\/$/, "");
  const token = process.env.TURSO_AUTH_TOKEN || "";
  if (!base || !token) throw new Error("Faltan las credenciales del catálogo de Tobías.");
  const respuesta = await fetch(`${base}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map(tursoArg) } },
        { type: "close" },
      ],
    }),
  });
  const data = await respuesta.json().catch(() => ({}));
  const resultado = data.results?.[0];
  if (!respuesta.ok || resultado?.type !== "ok") {
    throw new Error("No se pudo consultar la base comercial de Tobías.");
  }
  const tabla = resultado.response.result;
  return tabla.rows.map((row) =>
    Object.fromEntries(row.map((cell, indice) => [tabla.cols[indice].name, decodificar(cell)]))
  );
}

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const sqlSinAcentos = (columna) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${columna}),'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ñ','n')`;

export const HERRAMIENTAS_TOBIAS = [
  {
    name: "buscar_producto",
    description:
      "Busca productos y alternativas en el catálogo real de Tobías por texto y/o categoría. Devuelve id, nombre, precio, categoría y disponibilidad.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Palabras clave del producto." },
        categoria: { type: "string", description: "Nombre o parte de la categoría." },
        limite: { type: "integer", description: "Máximo de resultados, entre 1 y 8." },
      },
    },
  },
  {
    name: "verificar_disponibilidad",
    description:
      "Relee por id el precio y disponibilidad comercial del producto. No representa stock físico garantizado.",
    input_schema: {
      type: "object",
      properties: {
        producto_id: { type: "integer" },
        cantidad: { type: "integer" },
      },
      required: ["producto_id", "cantidad"],
    },
  },
  {
    name: "registrar_pedido",
    description:
      "Registra un pedido pendiente después de que el cliente confirmó el resumen. Es todo o nada y valida id, nombre y disponibilidad de cada producto.",
    input_schema: {
      type: "object",
      properties: {
        cliente_nombre: { type: "string" },
        cliente_telefono: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              producto_id: { type: "integer" },
              nombre_esperado: { type: "string" },
              cantidad: { type: "integer" },
            },
            required: ["producto_id", "nombre_esperado", "cantidad"],
          },
        },
      },
      required: ["cliente_nombre", "items"],
    },
  },
];

async function buscarProducto(input) {
  const texto = String(input?.texto || "").trim();
  const categoria = String(input?.categoria || "").trim();
  const limite = Math.min(Math.max(Number(input?.limite) || 5, 1), 8);
  if (!texto && !categoria) return { error: "Indicá texto o categoría para buscar." };

  const palabras = texto
    ? normalizarTexto(texto).split(/\s+/).filter(Boolean).slice(0, 6)
    : [];
  const categoriaNormalizada = normalizarTexto(categoria);
  const base =
    'SELECT p.id, p.name, p.price, p.available, c.name AS categoria ' +
    'FROM "Product" p JOIN "Category" c ON c.id = p.categoryId WHERE p.price > 0';
  const condicionCategoria = categoria
    ? ` AND ${sqlSinAcentos("c.name")} LIKE ?`
    : "";
  const argumentosCategoria = categoria ? [`%${categoriaNormalizada}%`] : [];

  async function ejecutar(modo) {
    const condiciones = palabras.map(() => `${sqlSinAcentos("p.name")} LIKE ?`);
    const condicionPalabras = condiciones.length
      ? ` AND (${condiciones.join(modo === "AND" ? " AND " : " OR ")})`
      : "";
    return turso(
      `${base}${condicionPalabras}${condicionCategoria} ORDER BY p.available DESC, p.price ASC LIMIT ?`,
      [...palabras.map((palabra) => `%${palabra}%`), ...argumentosCategoria, limite]
    );
  }

  let filas = await ejecutar("AND");
  if (!filas.length && palabras.length > 1) filas = await ejecutar("OR");
  const resultados = filas.map((fila) => ({
    id: fila.id,
    nombre: fila.name,
    precio: fila.price,
    categoria: fila.categoria,
    disponible: !!fila.available,
  }));
  return { resultados, cantidad: resultados.length };
}

async function verificarDisponibilidad(input) {
  const id = Number(input?.producto_id);
  const cantidad = Math.max(Number(input?.cantidad) || 1, 1);
  if (!id) return { error: "Falta un producto_id válido." };
  const filas = await turso(
    'SELECT p.id, p.name, p.price, p.available, c.name AS categoria ' +
      'FROM "Product" p JOIN "Category" c ON c.id = p.categoryId WHERE p.id = ? LIMIT 1',
    [id]
  );
  if (!filas.length) return { error: "No existe ese producto_id.", producto_id: id };
  const producto = filas[0];
  return {
    id: producto.id,
    nombre: producto.name,
    precio: producto.price,
    categoria: producto.categoria,
    cantidad_solicitada: cantidad,
    disponible: !!producto.available && producto.price > 0,
  };
}

function normalizarNombre(valor) {
  return String(valor || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const UNIDADES = new Set(["GR", "KG", "ML", "LTS", "UNI", "UND", "PACK", "CAJA", "SIN", "CON"]);

function palabrasClave(valor) {
  return normalizarNombre(valor)
    .split(/[^A-Z0-9]+/)
    .filter((palabra) => palabra.length >= 4 && !/^\d+$/.test(palabra) && !UNIDADES.has(palabra));
}

export function nombreCoincide(esperado, real) {
  if (!esperado) return false;
  const esperadas = new Set(palabrasClave(esperado));
  const reales = new Set(palabrasClave(real));
  for (const palabra of esperadas) if (reales.has(palabra)) return true;
  return esperadas.size === 0 && normalizarNombre(esperado) === normalizarNombre(real);
}

async function registrarPedido(input, contexto) {
  const nombre = String(input?.cliente_nombre || "").trim();
  const telefono = String(input?.cliente_telefono || contexto?.numero || "").trim();
  const pedido = Array.isArray(input?.items) ? input.items : [];
  if (!nombre) return { error: "Falta el nombre del cliente." };
  if (!pedido.length) return { error: "El pedido no tiene ítems." };

  const ids = [...new Set(pedido.map((item) => Number(item.producto_id)).filter(Boolean))];
  if (!ids.length) return { error: "Ningún producto_id es válido." };
  const filas = await turso(
    `SELECT p.*, c.id AS c_id, c.name AS c_name, c.slug AS c_slug,
            c.emoji AS c_emoji, c."order" AS c_order, c.createdAt AS c_createdAt
       FROM "Product" p JOIN "Category" c ON c.id = p.categoryId
      WHERE p.id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  const productos = Object.fromEntries(filas.map((producto) => [producto.id, producto]));
  const problemas = [];
  const items = [];
  let total = 0;

  for (const solicitado of pedido) {
    const id = Number(solicitado.producto_id);
    const cantidad = Math.max(Number(solicitado.cantidad) || 0, 0);
    const producto = productos[id];
    if (!producto) {
      problemas.push({ producto_id: id, motivo: "producto inexistente" });
      continue;
    }
    if (!cantidad) {
      problemas.push({ producto_id: id, motivo: "cantidad inválida" });
      continue;
    }
    if (!nombreCoincide(solicitado.nombre_esperado, producto.name)) {
      problemas.push({
        producto_id: id,
        motivo: "nombre_esperado no coincide con el producto real",
      });
      continue;
    }
    if (!producto.available || !(producto.price > 0)) {
      problemas.push({ producto_id: id, motivo: "producto no disponible" });
      continue;
    }

    total += producto.price * cantidad;
    const {
      c_id,
      c_name,
      c_slug,
      c_emoji,
      c_order,
      c_createdAt,
      ...productoPlano
    } = producto;
    productoPlano.available = !!productoPlano.available;
    productoPlano.featured = !!productoPlano.featured;
    productoPlano.category = {
      id: c_id,
      name: c_name,
      slug: c_slug,
      emoji: c_emoji,
      order: c_order,
      createdAt: c_createdAt,
    };
    productoPlano.borgestProduct = null;
    items.push({ product: productoPlano, quantity: cantidad });
  }

  if (problemas.length) {
    return {
      error: "No se registró el pedido: hay ítems con problemas.",
      problemas,
    };
  }

  total = Math.round(total * 100) / 100;
  const insertado = await turso(
    'INSERT INTO "Order" (customerName, phone, items, total, status, source) ' +
      'VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [nombre, telefono, JSON.stringify(items), total, "pending", "whatsapp"]
  );
  return {
    ok: true,
    pedido_id: insertado[0]?.id ?? null,
    estado: "pendiente de confirmación por una persona",
    total,
    resumen: items.map((item) => ({
      producto: item.product.name,
      cantidad: item.quantity,
      precio_unitario: item.product.price,
    })),
  };
}

export async function ejecutarHerramientaTobias(nombre, input, contexto = {}) {
  try {
    if (nombre === "buscar_producto") return JSON.stringify(await buscarProducto(input));
    if (nombre === "verificar_disponibilidad") {
      return JSON.stringify(await verificarDisponibilidad(input));
    }
    if (nombre === "registrar_pedido") {
      return JSON.stringify(await registrarPedido(input, contexto));
    }
    return JSON.stringify({ error: "Herramienta desconocida." });
  } catch {
    return JSON.stringify({ error: "La operación comercial no está disponible en este momento." });
  }
}
