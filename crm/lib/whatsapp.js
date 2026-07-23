export async function enviarTextoWhatsApp({ phoneNumberId, token, to, texto }) {
  const version = String(process.env.META_GRAPH_VERSION || "").trim();
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Falta META_GRAPH_VERSION o tiene un formato inválido.");
  const respuesta = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: texto },
    }),
  });
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(`Meta Graph API respondió ${respuesta.status}.`);
    error.status = 502;
    error.codigoPublico = "No se pudo enviar el mensaje por WhatsApp.";
    throw error;
  }
  return data?.messages?.[0]?.id || null;
}
