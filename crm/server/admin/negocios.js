import { exigirContexto, exigirSuperAdmin } from "../../lib/auth.js";
import { actualizarNegocio, crearNegocio } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

function slug(valor) {
  return texto(valor, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export default async function handler(req, res) {
  if (!soloMetodo(req, res, ["POST", "PATCH"])) return;
  try {
    const ctx = await exigirContexto(req);
    exigirSuperAdmin(ctx);
    const clave = slug(req.body?.clave);
    const nombre = texto(req.body?.nombre, 200);
    if (!clave || !nombre) return responderJson(res, 400, { error: "Faltan clave y/o nombre." });
    if (req.method === "POST") {
      const id = await crearNegocio({ clave, nombre, tier: "full" });
      return responderJson(res, 201, { id });
    }
    const id = enteroPositivo(req.body?.id);
    if (!id) return responderJson(res, 400, { error: "Id inválido." });
    await actualizarNegocio({
      id,
      clave,
      nombre,
      tier: texto(req.body?.tier, 80) || "full",
      activo: req.body?.activo !== false,
    });
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    if (/UNIQUE/i.test(error?.message || "")) error.codigoPublico = "Ya existe un negocio con esa clave.";
    return manejarError(res, error, "Error guardando el negocio.");
  }
}
