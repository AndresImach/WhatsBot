import { responder } from "../lib/router.js";
import { enviarTexto } from "../lib/whatsapp.js";

// Historial de conversación en memoria (por número).
// ⚠️ Se pierde cuando el servidor se reinicia. Para producción real conviene
// usar un store persistente (Vercel KV / Upstash Redis). Alcanza para arrancar.
const conversaciones = new Map();
const MAX_TURNOS = 12;

function getHistorial(numero) {
  if (!conversaciones.has(numero)) conversaciones.set(numero, []);
  return conversaciones.get(numero);
}

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

      const historial = getHistorial(numero);
      historial.push({ role: "user", content: texto });

      const { texto: respuesta, derivar } = await responder(historial);

      historial.push({ role: "assistant", content: respuesta });
      // Recortar historial para que no crezca infinito
      if (historial.length > MAX_TURNOS) {
        conversaciones.set(numero, historial.slice(-MAX_TURNOS));
      }

      await enviarTexto(numero, respuesta);

      // (Opcional) avisar al dueño cuando el bot deriva a un humano
      // if (derivar && process.env.OWNER_PHONE) {
      //   await enviarTexto(process.env.OWNER_PHONE,
      //     `🔔 El bot derivó una conversación. Cliente: ${numero}`);
      // }
    } catch (e) {
      console.error("Error procesando mensaje:", e);
    }
    return;
  }

  return res.status(405).send("Method not allowed");
}
