// Devuelve el STOCK EN VIVO de Usados y Nuevos Tucumán como texto listo para
// insertar en el prompt del sistema, donde negocios.js pone {{STOCK}}.
//
// Antes el STOCK era una foto estática (pegada a mano en negocios.js +
// lib/autosStock.js, para actualizar manualmente cada vez que cambiaba el
// catálogo real). Ahora se trae en vivo de la API del negocio — mismo patrón
// que api/catalogo.js para la PWA de pedidos: se pide UNA vez por conversación
// (no en cada turno, ver index.html:getSystem) para no romper el prompt
// caching, y se inyecta en promptBase antes de mandarlo al modelo.
// La tool "buscar_vehiculo" (api/chat.js) usa el mismo fetch con cache en
// memoria — ver lib/autosStock.js para el detalle.
import { obtenerTextoStock } from "../lib/autosStock.js";

const FALLBACK = "STOCK: no se pudo cargar en este momento. Si te preguntan por vehículos o precios, pedí disculpas y ofrecé derivar la consulta a un asesor.";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const texto = await obtenerTextoStock();
    return res.status(200).json({ texto });
  } catch (e) {
    return res.status(200).json({ texto: FALLBACK });
  }
}
