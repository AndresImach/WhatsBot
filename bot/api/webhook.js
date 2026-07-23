import { waitUntil } from "@vercel/functions";
import { responder } from "../lib/router.js";
import { enviarTexto } from "../lib/whatsapp.js";
import { registrarMensajeSeguro } from "../lib/crm.js";

export function historialParaRespuesta(ingreso, textoActual) {
  return ingreso?.historial?.length
    ? ingreso.historial
    : [{ role: "user", content: textoActual }];
}

export async function procesarWebhook(body) {
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];

    // Ignorar notificaciones de estado (entregado/leído) y no-texto.
    if (!msg || msg.type !== "text") return;

    const numero = msg.from;
    const texto = msg.text.body;
    const nombreContacto = value?.contacts?.[0]?.profile?.name || null;
    const canal = value?.metadata?.phone_number_id || process.env.PHONE_NUMBER_ID || null;

    const ingreso = await registrarMensajeSeguro(
      {
        numero,
        nombre: nombreContacto,
        phoneNumberId: canal,
        rol: "user",
        contenido: texto,
        idExterno: msg.id || null,
      },
      { etapa: "mensaje_entrante", messageId: msg.id || null }
    );

    // Si una persona atiende el chat, el CRM frena al bot. Ante una caída
    // central se degrada a responder usando solo el mensaje actual.
    if (ingreso?.duplicado) return;
    if (ingreso?.estado === "humano") return;
    const historial = historialParaRespuesta(ingreso, texto);
    const { texto: respuesta, derivar } = await responder(historial, { numero });

    const envio = await enviarTexto(numero, respuesta, canal);
    if (!envio.ok) return;
    await registrarMensajeSeguro(
      {
        numero,
        phoneNumberId: canal,
        rol: "assistant",
        contenido: respuesta,
        idExterno: envio.id || null,
        derivar: !!derivar,
      },
      { etapa: derivar ? "respuesta_y_derivacion" : "respuesta_bot", messageId: envio.id || msg.id || null }
    );
  } catch {
    console.error(JSON.stringify({ event: "webhook_processing_failed" }));
  }
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
    // Meta recibe el 200 enseguida y Vercel mantiene viva la promesa en segundo plano.
    waitUntil(procesarWebhook(req.body));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).send("Method not allowed");
}
