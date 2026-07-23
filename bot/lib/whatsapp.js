// Envía un mensaje de texto por la WhatsApp Cloud API (Graph API de Meta).
// Responder DENTRO de la ventana de 24hs (mensaje de servicio) no tiene costo.
function graphBase() {
  const version = String(process.env.META_GRAPH_VERSION || "").trim();
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Falta META_GRAPH_VERSION o tiene un formato inválido.");
  return `https://graph.facebook.com/${version}`;
}

// phoneNumberId: opcional, para mandar desde un canal específico (bandeja
// unificada). Sin él, usa el único número configurado en PHONE_NUMBER_ID.
export async function enviarTexto(to, texto, phoneNumberId) {
  const url = `${graphBase()}/${phoneNumberId || process.env.PHONE_NUMBER_ID}/messages`;
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
    console.error(
      JSON.stringify({
        event: "whatsapp_send_failed",
        status: r.status,
        requestId: r.headers.get("x-fb-request-id") || null,
      })
    );
    return { ok: false, id: null };
  }
  const data = await r.json().catch(() => ({}));
  return { ok: true, id: data?.messages?.[0]?.id || null };
}
