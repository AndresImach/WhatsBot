import { exigirContexto, exigirSuperAdmin } from "../../lib/auth.js";
import { cifrarSecreto } from "../../lib/crypto.js";
import { guardarCanal } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, ["POST", "PATCH"])) return;
  try {
    const ctx = await exigirContexto(req);
    exigirSuperAdmin(ctx);
    const id = req.method === "PATCH" ? enteroPositivo(req.body?.id) : null;
    const negocioId = enteroPositivo(req.body?.negocioId);
    const phoneNumberId = texto(req.body?.phoneNumberId, 100);
    const token = texto(req.body?.token, 10000);
    if ((req.method === "PATCH" && !id) || !negocioId || !phoneNumberId || (req.method === "POST" && !token)) {
      return responderJson(res, 400, { error: "Faltan negocioId, phoneNumberId y/o token." });
    }
    const canalId = await guardarCanal({
      id,
      negocioId,
      phoneNumberId,
      nombre: texto(req.body?.nombre, 200) || null,
      tokenCifrado: token ? cifrarSecreto(token) : null,
      activo: req.body?.activo !== false,
    });
    return responderJson(res, req.method === "POST" ? 201 : 200, { id: canalId, ok: true });
  } catch (error) {
    if (/UNIQUE/i.test(error?.message || "")) error.codigoPublico = "Ese Phone Number ID ya está registrado.";
    return manejarError(res, error, "Error guardando el canal.");
  }
}
