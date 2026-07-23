import { exigirContexto, idsNegocios } from "../../lib/auth.js";
import { listarConversaciones } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "GET")) return;
  try {
    const ctx = await exigirContexto(req);
    const negocioId = enteroPositivo(req.query?.negocioId);
    const scope = idsNegocios(ctx, negocioId);
    let asignado = req.query?.asignado ?? "";
    if (asignado === "mias") asignado = ctx.usuario.id;
    const conversaciones = await listarConversaciones(scope, {
      negocioId,
      estado: ["bot", "humano"].includes(req.query?.estado) ? req.query.estado : null,
      canalId: enteroPositivo(req.query?.canalId),
      asignado,
      etiqueta: texto(req.query?.etiqueta, 100) || null,
    });
    return responderJson(res, 200, { conversaciones });
  } catch (error) {
    return manejarError(res, error, "Error leyendo conversaciones.");
  }
}
