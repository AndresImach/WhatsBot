import { exigirContexto, idsNegocios } from "../../../lib/auth.js";
import { borrarAtajo } from "../../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "DELETE")) return;
  try {
    const ctx = await exigirContexto(req);
    const id = enteroPositivo(req.query?.id);
    if (!id) return responderJson(res, 400, { error: "Id inválido." });
    const negociosAdmin = ctx.negocios
      .filter((n) => ctx.usuario.esSuperAdmin || n.rol === "admin")
      .map((n) => n.id);
    if (!negociosAdmin.length && !ctx.usuario.esSuperAdmin) return responderJson(res, 403, { error: "Permisos insuficientes." });
    await borrarAtajo(id, ctx.usuario.esSuperAdmin ? idsNegocios(ctx) : negociosAdmin, ctx.usuario.esSuperAdmin);
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    return manejarError(res, error, "Error borrando el atajo.");
  }
}
