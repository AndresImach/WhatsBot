import { agenteDeSesion } from "../../lib/auth.js";

// Identidad del agente logueado. La UI lo usa para saber si ya había sesión
// y para resolver el filtro "Mías".
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const agente = agenteDeSesion(req);
  if (!agente) return res.status(401).json({ error: "No autorizado" });
  return res.status(200).json({ agente: { id: agente.id, usuario: agente.usuario, nombre: agente.nombre } });
}
