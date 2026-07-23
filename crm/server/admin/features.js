import { exigirContexto, exigirSuperAdmin } from "../../lib/auth.js";
import { guardarOverride, guardarPlanFeature } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

const FEATURES = new Set(["etiquetas", "notas", "valoracion", "atajos", "gestionUsuarios", "maxAgentes"]);

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const ctx = await exigirContexto(req);
    exigirSuperAdmin(ctx);
    const feature = texto(req.body?.feature, 100);
    const valor = req.body?.valor == null ? null : texto(req.body.valor, 100);
    if (!FEATURES.has(feature)) return responderJson(res, 400, { error: "Feature inválida." });
    if (req.body?.negocioId) {
      const negocioId = enteroPositivo(req.body.negocioId);
      if (!negocioId) return responderJson(res, 400, { error: "negocioId inválido." });
      await guardarOverride(negocioId, feature, valor);
    } else {
      const tier = texto(req.body?.tier, 80) || "full";
      if (valor == null || valor === "") return responderJson(res, 400, { error: "Falta valor." });
      await guardarPlanFeature(tier, feature, valor);
    }
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    return manejarError(res, error, "Error guardando features.");
  }
}
