import { agenteDeSesion } from "../../lib/auth.js";
import { listarConversaciones } from "../../lib/db.js";

// GET /api/backoffice/conversaciones
//   ?estado=humano|bot
//   ?canal=<phone_number_id>
//   ?asignado=mias|sin_asignar|<agenteId>
//   ?etiqueta=<etiqueta>
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const agente = agenteDeSesion(req);
  if (!agente) return res.status(401).json({ error: "No autorizado" });

  try {
    const { estado, canal, etiqueta } = req.query || {};
    let asignado = req.query?.asignado || null;
    if (asignado === "mias") asignado = agente.id;
    const conversaciones = await listarConversaciones({
      estado: estado || null,
      canal: canal || null,
      asignado,
      etiqueta: etiqueta || null,
    });
    return res.status(200).json({ conversaciones });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error leyendo conversaciones" });
  }
}
