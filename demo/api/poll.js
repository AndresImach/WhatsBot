import { getConversacion, listarMensajesDesde } from "../lib/db.js";

// Endpoint público (sin login): lo consume el propio widget de chat (index.html)
// mientras espera que una persona le responda. convId es un UUID random que
// solo conoce esa pestaña, así que no hace falta autenticación para leerlo.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { convId, desde } = req.query || {};
  if (!convId) return res.status(400).json({ error: "Falta 'convId'." });

  try {
    const conv = await getConversacion(convId);
    const mensajes = await listarMensajesDesde(convId, Number(desde) || 0);
    return res.status(200).json({ estado: conv?.estado || "bot", mensajes });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error consultando la conversación" });
  }
}
