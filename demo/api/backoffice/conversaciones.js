import { estaAutenticado } from "../../lib/auth.js";
import { listarConversaciones } from "../../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  try {
    const estado = req.query?.estado || null;
    const negocio = req.query?.negocio || null;
    const conversaciones = await listarConversaciones(estado, negocio);
    return res.status(200).json({ conversaciones });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error leyendo conversaciones" });
  }
}
