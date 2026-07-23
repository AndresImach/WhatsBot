import { exigirContexto, exigirFeature, idsNegocios } from "../../lib/auth.js";
import { getConversacionAutorizada, setValoracionConversacion } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const ctx = await exigirContexto(req);
    const id = enteroPositivo(req.body?.conversacionId);
    const valor = req.body?.valoracion ?? null;
    if (!id || !["positiva", "negativa", null].includes(valor)) return responderJson(res, 400, { error: "Datos de valoración inválidos." });
    const conv = await getConversacionAutorizada(id, idsNegocios(ctx));
    exigirFeature(ctx, conv.negocioId, "valoracion");
    await setValoracionConversacion(conv.id, conv.negocioId, valor);
    return responderJson(res, 200, { valoracion: valor });
  } catch (error) {
    return manejarError(res, error, "Error guardando la valoración.");
  }
}
