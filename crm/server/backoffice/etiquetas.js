import { exigirContexto, exigirFeature, idsNegocios } from "../../lib/auth.js";
import { getConversacionAutorizada, setEtiquetasConversacion } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const ctx = await exigirContexto(req);
    const id = enteroPositivo(req.body?.conversacionId);
    if (!id || !Array.isArray(req.body?.etiquetas)) return responderJson(res, 400, { error: "Faltan conversacionId y/o etiquetas." });
    const conv = await getConversacionAutorizada(id, idsNegocios(ctx));
    exigirFeature(ctx, conv.negocioId, "etiquetas");
    const etiquetas = await setEtiquetasConversacion(conv.id, conv.negocioId, req.body.etiquetas);
    return responderJson(res, 200, { etiquetas });
  } catch (error) {
    return manejarError(res, error, "Error guardando etiquetas.");
  }
}
