import { agenteDeSesion } from "../../lib/auth.js";
import { listarNotas, agregarNota } from "../../lib/db.js";

// GET  /api/backoffice/notas?convId=...   → hilo de notas internas
// POST /api/backoffice/notas { convId, texto } → agregar una nota (firmada con el agente logueado)
export default async function handler(req, res) {
  const agente = agenteDeSesion(req);
  if (!agente) return res.status(401).json({ error: "No autorizado" });

  if (req.method === "GET") {
    const convId = req.query?.convId;
    if (!convId) return res.status(400).json({ error: "Falta 'convId'." });
    try {
      return res.status(200).json({ notas: await listarNotas(convId) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error leyendo notas" });
    }
  }

  if (req.method === "POST") {
    const { convId, texto } = req.body || {};
    const limpio = String(texto || "").trim();
    if (!convId || !limpio) return res.status(400).json({ error: "Faltan 'convId' y/o 'texto'." });
    try {
      await agregarNota(convId, agente.id, agente.nombre, limpio);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error guardando la nota" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
