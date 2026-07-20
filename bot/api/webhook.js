import { responder } from "../lib/router.js";
import { enviarTexto } from "../lib/whatsapp.js";
import { nombreCanal } from "../lib/config.js";
import { upsertConversacion, getConversacion, setEstado, agregarMensaje, historialParaModelo } from "../lib/db.js";

export default async function handler(req, res) {
  // ── Verificación del webhook (Meta hace un GET al conectar) ──
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verificación fallida");
  }

  // ── Mensajes entrantes ──
  if (req.method === "POST") {
    // Respondemos 200 rápido para que Meta no reintente; procesamos después.
    res.status(200).json({ ok: true });

    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];

      // Ignorar notificaciones de estado (entregado/leído) y no-texto.
      if (!msg || msg.type !== "text") return;

      const numero = msg.from;
      const texto = msg.text.body;
      const nombreContacto = value?.contacts?.[0]?.profile?.name || null;
      const canal = value?.metadata?.phone_number_id || process.env.PHONE_NUMBER_ID || null;

      await upsertConversacion(numero, nombreContacto, canal, nombreCanal(canal));
      await agregarMensaje(numero, "user", texto);

      // Si una persona ya está atendiendo esta conversación desde el backoffice,
      // el bot no contesta: solo queda registrado el mensaje para que lo vea ahí.
      const conv = await getConversacion(numero);
      if (conv?.estado === "humano") return;

      const historial = await historialParaModelo(numero);
      const { texto: respuesta, derivar } = await responder(historial);

      await agregarMensaje(numero, "assistant", respuesta);
      if (derivar) await setEstado(numero, "humano");

      await enviarTexto(numero, respuesta, conv?.canal || canal);
    } catch (e) {
      console.error("Error procesando mensaje:", e);
    }
    return;
  }

  return res.status(405).send("Method not allowed");
}
