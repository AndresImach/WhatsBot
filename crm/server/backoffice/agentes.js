import { exigirContexto, exigirNegocio } from "../../lib/auth.js";
import { listarUsuariosNegocio } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "GET")) return;
  try {
    const ctx = await exigirContexto(req);
    const negocioId = enteroPositivo(req.query?.negocioId);
    if (!negocioId) return responderJson(res, 400, { error: "Falta negocioId." });
    exigirNegocio(ctx, negocioId);
    return responderJson(res, 200, { agentes: await listarUsuariosNegocio(negocioId) });
  } catch (error) {
    return manejarError(res, error, "Error leyendo agentes.");
  }
}
