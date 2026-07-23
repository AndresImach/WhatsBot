import { exigirContexto, idsNegocios } from "../../lib/auth.js";
import { getConversacionAutorizada, setEstadoConversacion } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const ctx = await exigirContexto(req);
    const id = enteroPositivo(req.body?.conversacionId);
    if (!id) return responderJson(res, 400, { error: "Falta conversacionId." });
    const conv = await getConversacionAutorizada(id, idsNegocios(ctx));
    await setEstadoConversacion(conv.id, conv.negocioId, "bot");
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    return manejarError(res, error, "Error devolviendo la conversación al bot.");
  }
}
