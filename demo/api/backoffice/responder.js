import { agenteDeSesion } from "../../lib/auth.js";
import { agregarMensaje, setEstado, getConversacion, asignar } from "../../lib/db.js";

// A diferencia de bot/ (que manda la respuesta por WhatsApp), acá no hay un
// canal externo: el widget de index.html está haciendo polling (ver
// demo/api/poll.js) y muestra este mensaje solo. Por eso alcanza con guardarlo.
// Si nadie tenía tomada la conversación, queda asignada automáticamente a
// quien contesta.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const agente = agenteDeSesion(req);
  if (!agente) return res.status(401).json({ error: "No autorizado" });

  const { convId, texto } = req.body || {};
  const limpio = String(texto || "").trim();
  if (!convId || !limpio) return res.status(400).json({ error: "Faltan 'convId' y/o 'texto'." });

  try {
    const conv = await getConversacion(convId);
    await agregarMensaje(convId, "humano", limpio);
    await setEstado(convId, "humano");
    if (!conv?.asignadoA) await asignar(convId, agente.id, agente.nombre);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error guardando la respuesta" });
  }
}
