// Envía un mensaje de texto por la WhatsApp Cloud API (Graph API de Meta).
// Responder DENTRO de la ventana de 24hs (mensaje de servicio) no tiene costo.
const GRAPH = "https://graph.facebook.com/v21.0";

// phoneNumberId: opcional, para mandar desde un canal específico (bandeja
// unificada). Sin él, usa el único número configurado en PHONE_NUMBER_ID.
export async function enviarTexto(to, texto, phoneNumberId) {
  const url = `${GRAPH}/${phoneNumberId || process.env.PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: texto },
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    console.error("Error enviando WhatsApp:", err);
  }
  return r.ok;
}
