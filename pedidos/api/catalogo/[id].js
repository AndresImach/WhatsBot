import { estaAutenticado } from "../../lib/auth.js";
import { actualizarProducto, borrarProducto, getProducto } from "../../lib/db.js";

const UNIDADES = ["kg", "g", "unidad"];

// PATCH  /api/catalogo/:id  → editar producto (nombre, unidad, precio, activo)
// DELETE /api/catalogo/:id  → baja definitiva (el historial no se rompe: cada
//                             ítem guarda el nombre del producto al momento del pedido)
export default async function handler(req, res) {
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });
  const id = Number(req.query?.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  if (req.method === "PATCH") {
    try {
      const { nombre, unidad, precio, activo } = req.body || {};
      if (unidad !== undefined && !UNIDADES.includes(unidad)) return res.status(400).json({ error: "Unidad inválida" });
      const campos = {};
      if (nombre !== undefined) campos.nombre = String(nombre).trim();
      if (unidad !== undefined) campos.unidad = unidad;
      if (precio !== undefined) campos.precio = precio === "" || precio === null ? null : Number(precio);
      if (activo !== undefined) campos.activo = activo;
      const producto = await actualizarProducto(id, campos);
      if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
      return res.status(200).json({ producto });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error actualizando el producto" });
    }
  }

  if (req.method === "DELETE") {
    try {
      if (!(await getProducto(id))) return res.status(404).json({ error: "Producto no encontrado" });
      await borrarProducto(id);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error borrando el producto" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
