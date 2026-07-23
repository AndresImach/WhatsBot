import { exigirContexto } from "../../lib/auth.js";
import { manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "GET")) return;
  try {
    const ctx = await exigirContexto(req);
    return responderJson(res, 200, ctx);
  } catch (error) {
    return manejarError(res, error, "Error leyendo la sesión.");
  }
}
