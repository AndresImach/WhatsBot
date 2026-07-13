import { estaAutenticado } from "../../lib/auth.js";
import { setEstado } from "../../lib/db.js";

// Devuelve el control de la conversación al bot (el widget lo detecta por polling).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  const { convId } = req.body || {};
  if (!convId) return res.status(400).json({ error: "Falta 'convId'." });

  try {
    await setEstado(convId, "bot");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error actualizando el estado" });
  }
}
