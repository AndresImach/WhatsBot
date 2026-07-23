import { descifrarSecreto } from "../../lib/crypto.js";
import { exigirContexto, idsNegocios } from "../../lib/auth.js";
import { getConversacionAutorizada, guardarMensajeHumano } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";
import { enviarTextoWhatsApp } from "../../lib/whatsapp.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const ctx = await exigirContexto(req);
    const conversacionId = enteroPositivo(req.body?.conversacionId);
    const contenido = texto(req.body?.texto, 16000);
    if (!conversacionId || !contenido) return responderJson(res, 400, { error: "Faltan conversacionId y/o texto." });
    const conv = await getConversacionAutorizada(conversacionId, idsNegocios(ctx));
    if (!conv.phoneNumberId || !conv.tokenCifrado) {
      return responderJson(res, 409, { error: "La conversación no tiene un canal de WhatsApp listo para responder." });
    }
    const idExterno = await enviarTextoWhatsApp({
      phoneNumberId: conv.phoneNumberId,
      token: descifrarSecreto(conv.tokenCifrado),
      to: conv.numero,
      texto: contenido,
    });
    await guardarMensajeHumano(conv, ctx.usuario, contenido, idExterno);
    return responderJson(res, 200, { ok: true, idExterno });
  } catch (error) {
    return manejarError(res, error, "Error enviando la respuesta.");
  }
}
