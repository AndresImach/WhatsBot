import { estaAutenticado } from "../../lib/auth.js";
import { listarMensajes } from "../../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  const numero = req.query?.numero;
  if (!numero) return res.status(400).json({ error: "Falta 'numero'." });

  try {
    const mensajes = await listarMensajes(numero);
    return res.status(200).json({ mensajes });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error leyendo mensajes" });
  }
}
