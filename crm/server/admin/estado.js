import { exigirContexto } from "../../lib/auth.js";
import { estadoAdministracion } from "../../lib/data.js";
import { manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "GET")) return;
  try {
    const ctx = await exigirContexto(req);
    const negociosAdmin = ctx.negocios
      .filter(
        (n) =>
          ctx.usuario.esSuperAdmin ||
          (n.rol === "admin" && n.features?.gestionUsuarios === true)
      )
      .map((n) => n.id);
    if (!ctx.usuario.esSuperAdmin && !negociosAdmin.length) {
      return responderJson(res, 403, { error: "No administrás ningún negocio." });
    }
    const estado = await estadoAdministracion(
      ctx.usuario.esSuperAdmin ? ctx.negocios.map((n) => n.id) : negociosAdmin,
      ctx.usuario.esSuperAdmin
    );
    return responderJson(res, 200, estado);
  } catch (error) {
    return manejarError(res, error, "Error leyendo la administración.");
  }
}
