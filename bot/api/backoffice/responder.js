import { estaAutenticado } from "../../lib/auth.js";
import { agregarMensaje, setEstado } from "../../lib/db.js";
import { enviarTexto } from "../../lib/whatsapp.js";

// Manda una respuesta como PERSONA (no el bot) por WhatsApp, la deja registrada
// con rol 'humano', y marca la conversación como atendida por una persona para
// que el bot no le conteste encima.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  const { numero, texto } = req.body || {};
  const limpio = String(texto || "").trim();
  if (!numero || !limpio) return res.status(400).json({ error: "Faltan 'numero' y/o 'texto'." });

  try {
    const ok = await enviarTexto(numero, limpio);
    if (!ok) return res.status(502).json({ error: "No se pudo enviar el mensaje por WhatsApp." });
    await agregarMensaje(numero, "humano", limpio);
    await setEstado(numero, "humano");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error enviando la respuesta" });
  }
}
