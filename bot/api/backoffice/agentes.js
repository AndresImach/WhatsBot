import { estaAutenticado } from "../../lib/auth.js";
import { listarAgentes } from "../../lib/db.js";

// Lista de agentes activos, para el selector de asignación del panel.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  try {
    return res.status(200).json({ agentes: await listarAgentes() });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error leyendo agentes" });
  }
}
