// Stock EN VIVO de "Usados y Nuevos Tucumán" — se trae desde la API real del
// negocio (WordPress, action=usados_filter_vehicles) en vez de una foto de
// texto pegada a mano. Se cachea en memoria (CACHE_TTL_MS) porque esta función
// la llaman tanto la tool "buscar_vehiculo" (api/chat.js, dentro del loop de
// tools de una conversación) como api/autos.js (arma el bloque STOCK del
// prompt) — así no se golpea la API externa en cada mensaje.
//
// Por qué el filtrado numérico (año/km/presupuesto) es una tool y no algo que
// lee el modelo: con el STOCK como texto en el prompt y un modelo barato, el
// modelo "filtraba a ojo" leyendo la lista y se colaban unidades fuera de
// rango (bug real: pidieron una SUV con menos de 80.000 km y devolvió una con
// 110.000). La única forma de garantizar que un rango se respete siempre es
// que la comparación numérica la haga código (acá abajo), no el modelo.

const USADOS_API_URL = "https://usadosynuevostucuman.com/wp-admin/admin-ajax.php?action=usados_filter_vehicles";
const USADOS_BASE_URL = "https://usadosynuevostucuman.com";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos: stock real, no hace falta más fresco que esto.

const TIPO_API_A_INTERNO = { "PICK UP": "pickup", SUV: "suv", SEDAN: "sedan", HATCHBACK: "hatchback" };
const DISPONIBILIDAD_API_A_INTERNO = {
  "Stock Físico": "stock",
  "Consultar Disponibilidad": "consultar",
  Vendido: "vendido",
};

let _cache = null; // { raw, items, ts }

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Acepta variantes con las que el modelo podría mandar la moneda ("pesos", "dólares",
// "u$s") además de los literales "$"/"USD" del schema, para no perder un filtro de
// presupuesto válido por una diferencia de formato.
function normalizarMoneda(m) {
  const n = normalizar(m);
  if (!n) return null;
  if (/usd|dolar|u\$s/.test(n)) return "USD";
  if (/\$|peso|ars/.test(n)) return "$";
  return null;
}

// El schema le pide 'pickup'/'suv'/'sedan'/'hatchback', pero por si el modelo
// manda una variante ("pick up", "camioneta", "hatch") la mapeamos al tipo canónico
// en vez de comparar substrings (evita falsos positivos/negativos con "sedan" vs "suv").
function normalizarTipo(s) {
  const n = normalizar(s).replace(/[\s-]/g, "");
  if (!n) return null;
  if (/camioneta|pickup/.test(n)) return "pickup";
  if (/suv/.test(n)) return "suv";
  if (/sedan/.test(n)) return "sedan";
  if (/hatch/.test(n)) return "hatchback";
  return n;
}

function slugUrl(s) {
  return normalizar(s)
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prepararItemParaPrompt(raw) {
  const { imagen_url, galeria, descripcion, fecha_creacion, ...item } = raw;
  const segmentos = [raw.marca, raw.modelo];
  if (String(raw.version || "").trim()) segmentos.push(raw.version);
  segmentos.push(raw.id);
  return {
    ...item,
    link_url: `${USADOS_BASE_URL}/vehiculo/${segmentos.map(slugUrl).join("/")}/`,
  };
}

// La API manda 'precio' (texto, ej "$30.500.000" / "38.000 USD" / "$ (Consultar)")
// y 'precio_numerico' (el monto, en la moneda de 'precio', o "0" si es a consultar).
function parsearPrecio(raw) {
  const precioStr = String(raw.precio || "").trim();
  const moneda = /usd/i.test(precioStr) ? "USD" : precioStr.includes("$") ? "$" : null;
  const numerico = Number(raw.precio_numerico);
  if (!precioStr || !numerico) return { moneda, precio: null };
  return { moneda, precio: numerico };
}

function mapearItem(raw) {
  const { moneda, precio } = parsearPrecio(raw);
  const nombre = [raw.marca, raw.modelo, raw.version].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return {
    id: raw.id,
    tipo: TIPO_API_A_INTERNO[String(raw.tipo || "").toUpperCase()] || normalizarTipo(raw.tipo),
    marca: raw.marca || "",
    nombre,
    anio: Number(raw.ano) || null,
    km: raw.kilometros !== "" && raw.kilometros != null ? Number(raw.kilometros) : null,
    transmision: normalizar(raw.transmision) === "manual" ? "manual" : "automatica",
    combustible: raw.combustible ? normalizar(raw.combustible) : null,
    moneda,
    precio,
    disponibilidad: DISPONIBILIDAD_API_A_INTERNO[raw.disponibilidad] || normalizar(raw.disponibilidad),
  };
}

// Trae el stock real, cacheado CACHE_TTL_MS en memoria. Si la API externa
// está caída, devuelve el último stock cacheado (aunque esté vencido) antes
// que romper la conversación — solo lanza si nunca hubo un fetch exitoso.
async function obtenerStock() {
  const ahora = Date.now();
  if (_cache && ahora - _cache.ts < CACHE_TTL_MS) return _cache.items;
  try {
    const r = await fetch(USADOS_API_URL);
    const raw = await r.json();
    const items = (raw.data || []).map(mapearItem).filter((v) => v.tipo && v.anio);
    _cache = { raw, items, ts: ahora };
    return items;
  } catch (e) {
    if (_cache) return _cache.items;
    throw e;
  }
}

// Filtra el stock con comparaciones numéricas EXACTAS — nunca dejar que el
// modelo estime "menos de N años" o "menos de N km" leyendo texto: siempre
// tiene que pasar por acá.
async function buscarVehiculos(filtro = {}) {
  const {
    tipo,
    marca,
    anio_min,
    antiguedad_max_anios,
    km_max,
    presupuesto_max,
    moneda,
    transmision,
    combustible,
    incluir_vendidos,
    limite,
    mostrar_todos,
  } = filtro;

  const items = await obtenerStock();

  let anioMinEfectivo = anio_min != null ? Number(anio_min) : null;
  if (antiguedad_max_anios != null) {
    // "menos de N años" => el modelo tiene que ser de hace menos de N años,
    // calculado contra el año ACTUAL del servidor (nunca el que el modelo crea que es hoy).
    const anioActual = new Date().getFullYear();
    const cota = anioActual - Number(antiguedad_max_anios) + 1;
    anioMinEfectivo = anioMinEfectivo != null ? Math.max(anioMinEfectivo, cota) : cota;
  }

  const tipoNorm = tipo ? normalizarTipo(tipo) : null;
  const marcaNorm = marca ? normalizar(marca) : null;
  const transmisionNorm = transmision ? normalizar(transmision) : null;
  const combustibleNorm = combustible ? normalizar(combustible) : null;
  const monedaNorm = moneda ? normalizarMoneda(moneda) : null;

  const coincide = (v) => {
    if (tipoNorm && v.tipo !== tipoNorm) return false;
    if (marcaNorm && !normalizar(v.marca).includes(marcaNorm)) return false;
    if (anioMinEfectivo != null && v.anio < anioMinEfectivo) return false;
    if (km_max != null && (v.km == null || v.km > Number(km_max))) return false;
    if (transmisionNorm && v.transmision !== transmisionNorm) return false;
    if (combustibleNorm && v.combustible !== combustibleNorm) return false;
    if (presupuesto_max != null) {
      if (!monedaNorm) return false; // sin moneda reconocible no podemos comparar $ vs USD con seguridad
      if (v.moneda !== monedaNorm || v.precio == null || v.precio > Number(presupuesto_max)) return false;
    }
    if (!incluir_vendidos && v.disponibilidad === "vendido") return false;
    return true;
  };

  const matches = items.filter(coincide);
  const tope = mostrar_todos ? matches.length : Math.min(Math.max(Number(limite) || 6, 1), 10);
  return {
    resultados: matches.slice(0, tope),
    total_matches: matches.length,
    presupuesto_ignorado: presupuesto_max != null && !monedaNorm, // aviso: no se pudo filtrar por precio
  };
}

// Prepara el JSON del prompt a partir del raw de la API: excluye vendidos y
// campos pesados que el modelo no necesita, y agrega el enlace de cada unidad.
// El filtrado numérico sigue usando los items normalizados de obtenerStock().
async function obtenerTextoStock() {
  await obtenerStock();
  const data = (_cache.raw.data || [])
    .filter((v) => v.disponibilidad !== "Vendido")
    .map(prepararItemParaPrompt);
  if (!data.length) {
    return "STOCK: no se pudo cargar el stock en este momento. Si te preguntan por vehículos o precios, pedí disculpas y ofrecé derivar la consulta a un asesor.";
  }
  return JSON.stringify(data);
}

export { buscarVehiculos, obtenerTextoStock };
