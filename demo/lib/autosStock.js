// Stock de "Usados y Nuevos Tucumán" — misma foto (17/07) que el bloque STOCK
// pegado en el prompt de negocios.js, pero acá PARSEADO a datos numéricos
// (año, km, precio) para que el filtrado por rango lo haga código, no el modelo.
//
// Por qué existe este archivo: negocios.js solo tenía el STOCK como texto en el
// prompt, y el modelo filtraba "a ojo" leyendo las 74 líneas (año < X años, km <
// Y, presupuesto < Z). Con un modelo barato y una lista larga, esa lectura falla
// silenciosamente y se cuelan unidades fuera de rango (bug real: pidieron una SUV
// con menos de 80.000 km y devolvió una con 110.000). La única forma de garantizar
// que "menos de 80.000 km" se respete siempre es que la comparación numérica la
// haga una tool (buscar_vehiculo en api/chat.js), no el modelo leyendo texto.
//
// negocios.js (navegador, <script> sin módulos) no puede importar este archivo
// (server, ESM) — por eso el texto del STOCK sigue duplicado ahí para mostrarlo
// en el prompt. Si recargás el stock desde la web, actualizá ESTE archivo (las
// líneas de abajo) Y el bloque STOCK de negocios.js con los mismos datos.

const RUBROS = {
  "PICK UPS / CAMIONETAS": "pickup",
  SUVS: "suv",
  SEDANES: "sedan",
  HATCHBACKS: "hatchback",
};

const TEXTO_STOCK = `
PICK UPS / CAMIONETAS:
- Volkswagen Saveiro Safety SC/GAS — 2018 · 105.000 km · Manual · Nafta · $16.400.000 · [STOCK]
- Volkswagen Saveiro Extreme — 2026 · 300 km · Manual · Nafta · $38.000.000 · [STOCK]
- Volkswagen Amarok V6 Comfortline — 2022 · 75.000 km · Automática · Diésel · $42.000.000 · [STOCK]
- Volkswagen Amarok Highline 4x2 AT — 2023 · 72.000 km · Automática · Diésel · $41.700.000 · [VENDIDO]
- Volkswagen Amarok Highline — 2024 · 35.000 km · Automática · Diésel · $47.000.000 · [VENDIDO]
- Volkswagen Amarok V6 Extreme — 2025 · 27.000 km · Automática · Diésel · $65.000.000 · [VENDIDO]
- Volkswagen Amarok Comfortline — 2020 · 105.000 km · Automática · Diésel · $33.000.000 · [VENDIDO]
- Volkswagen Amarok Comfortline — 2020 · 83.000 km · Manual · Diésel · $33.000.000 · [VENDIDO]
- Volkswagen Amarok Comfortline 4x4 — 2017 · 135.000 km · Automática · Diésel · $28.500.000 · [CONSULTAR]
- Volkswagen Amarok V6 Comfortline (0km) — 2026 · 0 km · Automática · Diésel · precio a consultar · [CONSULTAR]
- Volkswagen Amarok V6 Highline (0km) — 2026 · 0 km · Automática · Diésel · precio a consultar · [CONSULTAR]
- Volkswagen Amarok V6 Hero (0km) — 2026 · 0 km · Automática · Diésel · precio a consultar · [CONSULTAR]
- Ford Ranger Safety — 2022 · 101.000 km · Manual · Diésel · $30.000.000 · [STOCK]
- Ford Ranger V6 Limited — 2024 · 65.000 km · Automática · Diésel · $62.000.000 · [CONSULTAR]
- Ford Ranger V6 LTD — 2023 · 37.000 km · Automática · Diésel · $60.000.000 · [VENDIDO]
- Ford Ranger Raptor — 2026 · 4.000 km · Automática · Nafta · USD 75.000 · [CONSULTAR]
- Ford F-150 Raptor — 2023 · 70.000 km · Automática · Nafta · USD 80.000 · [VENDIDO]
- Toyota Hilux SRV — 2016 · 205.000 km · Manual · Diésel · $30.500.000 · [CONSULTAR]
- Nissan Frontier SE 4x4 — 2022 · 85.000 km · Manual · Diésel · $30.000.000 · [STOCK]
- Chevrolet S10 C/S — 2026 · 0 km · Manual · Diésel · $46.000.000 · [STOCK]
- Chevrolet S10 LTZ — 2022 · 135.000 km · Automática · Diésel · $36.000.000 · [CONSULTAR]
- Fiat Toro Volcano 4x4 AT — 2019 · 54.000 km · Automática · Diésel · $27.000.000 · [VENDIDO]

SUVS:
- Volkswagen Taos Highline (0km) — 2026 · 0 km · Automática · Nafta · precio a consultar · [CONSULTAR]
- Volkswagen Taos Comfortline — 2022 · 47.000 km · Automática · Nafta · $35.000.000 · [VENDIDO]
- Volkswagen T-Cross Trendline — 2025 · 8.000 km · Automática · Nafta · $35.000.000 · [STOCK]
- Volkswagen Nivus Comfortline — 2022 · 35.000 km · Automática · Nafta · $28.000.000 · [STOCK]
- Toyota Corolla Cross SEG HEV — 2026 · 0 km · Automática · Híbrido · precio a consultar · [STOCK]
- Toyota SW4 Diamond — 2023 · 23.000 km · Automática · Diésel · $68.000.000 · [VENDIDO]
- Toyota SW4 GR — 2024 · 30.000 km · Automática · Diésel · $78.000.000 · [VENDIDO]
- Jeep Compass Serie S — 2025 · 8.000 km · Automática · $46.000.000 · [STOCK]
- Jeep Compass Limited — 2020 · 35.000 km · Automática · Nafta · $33.700.000 · [VENDIDO]
- Jeep Compass Longitude Plus — 2024 · 11.000 km · Automática · Nafta · $47.000.000 · [VENDIDO]
- Jeep Compass Blackhawk — 2025 · 6.000 km · Automática · Nafta · $60.000.000 · [VENDIDO]
- Jeep Commander Blackhawk — 2025 · 5.000 km · Automática · Nafta · $66.000.000 · [VENDIDO]
- Jeep Renegade Sport — 2021 · 80.000 km · Automática · Nafta · $25.000.000 · [VENDIDO]
- Ford Territory 1.5T Titanium — 2021 · 98.000 km · Automática · Nafta · $30.000.000 · [STOCK]
- Ford Territory 1.8T Titanium — 2023 · 28.000 km · Automática · Nafta · $45.000.000 · [VENDIDO]
- Ford Bronco Big Bend — 2023 · 27.000 km · Automática · Nafta · $50.000.000 · [VENDIDO]
- Ford EcoSport Storm 4x4 — 2020 · 50.000 km · Automática · Nafta · $26.000.000 · [VENDIDO]
- Kia Sportage EX — 2018 · 97.000 km · Automática · Nafta · $26.000.000 · [VENDIDO]
- GWM HAVAL H6 GT — 2026 · 1.700 km · Automática · Nafta · USD 44.000 · [STOCK]
- Audi Q3 35 TFSI — 2024 · 55.000 km · Automática · Nafta · USD 38.000 · [STOCK]
- Audi Q5 Advance — 2021 · 60.000 km · Automática · Nafta · USD 50.000 · [VENDIDO]
- BMW X4 35i xDrive — 2017 · 73.000 km · Automática · Nafta · USD 44.000 · [VENDIDO]
- Mercedes-Benz GLC 300 4Matic Urban — 2016 · 70.000 km · Automática · Nafta · USD 40.000 · [VENDIDO]
- BAIC X55 Plus (0km) — 2026 · 0 km · Automática · Nafta · USD 43.700 · [STOCK]
- BAIC X55 Luxury — 2024 · 18.000 km · Automática · Nafta · USD 30.000 · [VENDIDO]

SEDANES:
- Nissan Versa Exclusive — 2022 · 60.000 km · Automática · Nafta · $26.000.000 · [STOCK]
- Nissan Versa Advance — 2018 · 110.000 km · Automática · Nafta · $16.000.000 · [STOCK]
- Toyota Etios XLS — 2018 · 58.000 km · Automática · Nafta · $20.000.000 · [VENDIDO]
- Toyota Corolla XLI — 2013 · 30.000 km · Manual · Nafta · USD 13.500 · [VENDIDO]
- Audi A3 Sedán 1.4T — 2015 · 117.000 km · Automática · Nafta · USD 16.000 · [STOCK]
- Audi A3 Sedán — 2025 · 8.000 km · Automática · Nafta · USD 38.000 · [VENDIDO]
- Mercedes-Benz CLA 200 Urban — 2014 · 95.000 km · Automática · Nafta · USD 18.000 · [STOCK]
- BAIC Beijing EU5 (eléctrico, 0km) — 2026 · 0 km · Automática · Eléctrico · USD 30.000 · [STOCK]
- BAIC Beijing U5 Plus (0km) — 2026 · 0 km · Automática · Nafta · USD 26.800 · [STOCK]

HATCHBACKS:
- Chevrolet Onix Joy Black — 2022 · 76.000 km · Manual · Nafta · $18.500.000 · [STOCK]
- Ford KA SEL Freestyle — 2020 · 35.000 km · Automática · Nafta · $20.000.000 · [CONSULTAR]
- Volkswagen Gol Trend Trendline — 2021 · 40.000 km · Manual · Nafta · $20.000.000 · [STOCK]
- Volkswagen Gol Trend Trendline — 2018 · 120.000 km · Manual · Nafta · $16.000.000 · [STOCK]
- Fiat Palio Attractive — 2015 · 85.000 km · Manual · Nafta · $14.000.000 · [STOCK]
- Fiat Palio Attractive Top — 2018 · 58.000 km · Manual · Nafta · $15.600.000 · [STOCK]
- Toyota Etios XLS — 2017 · 60.000 km · Manual · Nafta · $16.000.000 · [VENDIDO]
- Peugeot 208 Feline — 2023 · 33.000 km · Automática · Nafta · $25.100.000 · [VENDIDO]
- Peugeot 208 Allure — 2022 · 52.000 km · Manual · Nafta · $20.500.000 · [CONSULTAR]
- Peugeot 208 Allure — 2023 · 33.000 km · Manual · Nafta · $20.600.000 · [VENDIDO]
- Renault Clio Confort — 2014 · 115.000 km · Manual · Nafta · $12.000.000 · [VENDIDO]
- Renault Sandero Intens — 2024 · 38.800 km · Automática · Nafta · $24.000.000 · [VENDIDO]
- Renault Sandero Stepway Intens — 2024 · 14.000 km · Manual · Nafta · $25.000.000 · [VENDIDO]
- Audi A1 Sportback — 2021 · 135.000 km · Automática · Nafta · USD 23.500 · [STOCK]
- Audi A1 Sportback MT — 2018 · 66.000 km · Manual · Nafta · $26.000.000 · [CONSULTAR]
- BMW 116i Urban — 2012 · 58.000 km · Manual · Nafta · USD 15.000 · [VENDIDO]
- Mercedes-Benz A200 Urban — 2017 · 29.000 km · Automática · Nafta · USD 26.000 · [STOCK]
- Mercedes-Benz A200 Progressive — 2022 · 26.000 km · Automática · Nafta · USD 39.000 · [VENDIDO]
`;

const LINEA_RE =
  /^-\s*(.+?)\s*—\s*(\d{4})\s*·\s*([\d.]+)\s*km\s*·\s*(Manual|Automática)\s*·\s*(?:(Nafta|Diésel|Híbrido|Eléctrico)\s*·\s*)?(?:\$\s*([\d.]+)|USD\s*([\d.,]+)|precio a consultar)\s*·\s*\[(STOCK|CONSULTAR|VENDIDO)\]\s*$/;

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

function parseStock(texto) {
  const items = [];
  let rubroActual = null;
  for (const linea of texto.split("\n")) {
    const t = linea.trim();
    if (!t) continue;
    if (RUBROS[t.replace(/:$/, "")]) {
      rubroActual = RUBROS[t.replace(/:$/, "")];
      continue;
    }
    const m = LINEA_RE.exec(t);
    if (!m) continue; // línea de encabezado u otro texto que no matchea una unidad
    const [, nombre, anioStr, kmStr, transmision, combustible, precioArs, precioUsd] = m;
    const disponibilidadRaw = m[8];
    let moneda = null;
    let precio = null;
    if (precioArs) {
      moneda = "$";
      precio = Number(precioArs.replace(/\./g, ""));
    } else if (precioUsd) {
      moneda = "USD";
      precio = Number(precioUsd.replace(/\./g, "").replace(",", "."));
    }
    items.push({
      tipo: rubroActual,
      marca: nombre.split(" ")[0],
      nombre,
      anio: Number(anioStr),
      km: Number(kmStr.replace(/\./g, "")),
      transmision: normalizar(transmision) === "manual" ? "manual" : "automatica",
      combustible: combustible ? normalizar(combustible) : null,
      moneda,
      precio,
      disponibilidad: disponibilidadRaw.toLowerCase(),
    });
  }
  return items;
}

const STOCK_AUTOS = parseStock(TEXTO_STOCK);

// Filtra el stock con comparaciones numéricas EXACTAS — nunca dejar que el
// modelo estime "menos de N años" o "menos de N km" leyendo texto: siempre
// tiene que pasar por acá.
function buscarVehiculos(filtro = {}) {
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
  } = filtro;

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
    if (km_max != null && v.km > Number(km_max)) return false;
    if (transmisionNorm && v.transmision !== transmisionNorm) return false;
    if (combustibleNorm && v.combustible !== combustibleNorm) return false;
    if (presupuesto_max != null) {
      if (!monedaNorm) return false; // sin moneda reconocible no podemos comparar $ vs USD con seguridad
      if (v.moneda !== monedaNorm || v.precio == null || v.precio > Number(presupuesto_max)) return false;
    }
    if (!incluir_vendidos && v.disponibilidad === "vendido") return false;
    return true;
  };

  const matches = STOCK_AUTOS.filter(coincide);
  const tope = Math.min(Math.max(Number(limite) || 6, 1), 10);
  return {
    resultados: matches.slice(0, tope),
    total_matches: matches.length,
    presupuesto_ignorado: presupuesto_max != null && !monedaNorm, // aviso: no se pudo filtrar por precio
  };
}

export { STOCK_AUTOS, buscarVehiculos };
