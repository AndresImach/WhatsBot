import { estaAutenticado, esBot } from "../../lib/auth.js";
import { listarCatalogo, crearProducto } from "../../lib/db.js";

const UNIDADES = ["kg", "g", "unidad"];

// GET  /api/catalogo            → lista de productos (PIN; el bot también puede leerla)
// GET  /api/catalogo?activos=1  → solo los activos (lo usa el bot para armar pedidos)
// POST /api/catalogo            → alta de producto (PIN)
export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!estaAutenticado(req) && !esBot(req)) return res.status(401).json({ error: "No autorizado" });
    try {
      const soloActivos = req.query?.activos === "1" || req.query?.activos === "true";
      return res.status(200).json({ catalogo: await listarCatalogo({ soloActivos }) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error leyendo el catálogo" });
    }
  }

  if (req.method === "POST") {
    if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });
    try {
      const { nombre, unidad, precio, activo } = req.body || {};
      if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: "Falta el nombre" });
      if (unidad && !UNIDADES.includes(unidad)) return res.status(400).json({ error: "Unidad inválida" });
      const producto = await crearProducto({
        nombre: String(nombre).trim(),
        unidad,
        precio: precio === "" || precio === undefined || precio === null ? null : Number(precio),
        activo,
      });
      return res.status(201).json({ producto });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error creando el producto" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
