// Devuelve el catálogo ACTIVO de la PWA de pedidos (carpeta pedidos/) como texto
// listo para insertar en el prompt del sistema, donde negocios.js pone {{CATALOGO}}.
//
// Antes el catálogo se traía con una tool ("ver_catalogo") en cada conversación.
// Eso rompía el prompt caching: el resultado de la tool vivía solo dentro del loop
// de esa request y nunca viajaba al turno siguiente (el navegador solo reenvía
// texto plano), así que cada vez que el modelo necesitaba el catálogo pagaba una
// ronda extra completa (system + tools + todo el historial) sin ningún descuento
// de caché. Trayéndolo UNA vez por conversación y metiéndolo en el system prompt
// (que sí es estable turno a turno), el prefijo cacheable queda más grande y
// consistente, y el modelo ya no necesita pedirlo por su cuenta.
// El token PEDIDOS_API_TOKEN es secreto: por eso esto vive en el server y no se
// llama directo desde el navegador (a diferencia de cartelera.js, que sí puede
// porque la API del cine tiene CORS abierto y no requiere auth).
const PEDIDOS_API_URL = (process.env.PEDIDOS_API_URL || "").replace(/\/$/, "");
const FALLBACK =
  "CATÁLOGO: no disponible en este momento. Si te preguntan por productos o precios, pedí disculpas y ofrecé derivar la consulta a una persona del local.";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!PEDIDOS_API_URL) return res.status(200).json({ texto: FALLBACK });
  try {
    const r = await fetch(PEDIDOS_API_URL + "/api/catalogo?activos=1", {
      headers: { Authorization: "Bearer " + (process.env.PEDIDOS_API_TOKEN || "") },
    });
    const data = await r.json().catch(() => ({}));
    const productos = (data.catalogo || []).map((p) => ({ id: p.id, nombre: p.nombre, unidad: p.unidad, precio: p.precio }));
    if (!productos.length) {
      return res.status(200).json({
        texto: "CATÁLOGO: no hay productos activos cargados en este momento. Avisale al cliente y ofrecé derivarlo a una persona del local.",
      });
    }
    const filas = productos.map((p) => `- id ${p.id} | ${p.nombre} | ${p.unidad} | $${p.precio}`).join("\n");
    const texto =
      `CATÁLOGO ACTUAL (productos activos, id | nombre | unidad | precio):\n${filas}\n\n` +
      "Usá SIEMPRE el 'id', 'nombre' y 'unidad' EXACTOS de esta lista al llamar crear_pedido. Si el cliente pide algo que no está acá, decilo y ofrecé lo que sí hay.";
    return res.status(200).json({ texto });
  } catch (e) {
    return res.status(200).json({ texto: FALLBACK });
  }
}
