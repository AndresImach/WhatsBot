import { estaAutenticado } from "../../lib/auth.js";
import { asignar, listarAgentes } from "../../lib/db.js";

// POST { convId, agenteId }       → asignar/tomar o reasignar a otro agente
// POST { convId, agenteId: null } → sacar la asignación (vuelve a "sin asignar")
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  const { convId, agenteId } = req.body || {};
  if (!convId) return res.status(400).json({ error: "Falta 'convId'." });

  try {
    if (agenteId === null || agenteId === undefined) {
      await asignar(convId, null, null);
      return res.status(200).json({ ok: true });
    }
    const agentes = await listarAgentes();
    const destino = agentes.find((a) => a.id === Number(agenteId));
    if (!destino) return res.status(400).json({ error: "Agente inválido." });
    await asignar(convId, destino.id, destino.nombre);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error asignando la conversación" });
  }
}
