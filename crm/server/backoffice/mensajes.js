import { exigirContexto, idsNegocios } from "../../lib/auth.js";
import { getConversacionAutorizada, listarMensajes } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "GET")) return;
  try {
    const ctx = await exigirContexto(req);
    const id = enteroPositivo(req.query?.conversacionId);
    if (!id) return responderJson(res, 400, { error: "Falta conversacionId." });
    const conv = await getConversacionAutorizada(id, idsNegocios(ctx));
    const mensajes = await listarMensajes(conv.id, conv.negocioId);
    return responderJson(res, 200, { conversacion: { ...conv, tokenCifrado: undefined }, mensajes });
  } catch (error) {
    return manejarError(res, error, "Error leyendo mensajes.");
  }
}
