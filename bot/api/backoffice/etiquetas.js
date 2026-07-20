import { estaAutenticado } from "../../lib/auth.js";
import { setEtiquetas } from "../../lib/db.js";

// POST { numero, etiquetas: ["queja", "vip"] } → reemplaza el set completo de etiquetas.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  const { numero, etiquetas } = req.body || {};
  if (!numero || !Array.isArray(etiquetas)) return res.status(400).json({ error: "Faltan 'numero' y/o 'etiquetas' (array)." });

  try {
    const limpio = await setEtiquetas(numero, etiquetas);
    return res.status(200).json({ etiquetas: limpio });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error guardando etiquetas" });
  }
}
