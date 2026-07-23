import { exigirContexto, exigirFeature, exigirNegocio } from "../../lib/auth.js";
import { borrarMembresia, contarUsuariosNegocio, getMembresia, getUsuarioPorId, guardarMembresia } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, ["POST", "DELETE"])) return;
  try {
    const ctx = await exigirContexto(req);
    const usuarioId = enteroPositivo(req.body?.usuarioId);
    const negocioId = enteroPositivo(req.body?.negocioId);
    if (!usuarioId || !negocioId) return responderJson(res, 400, { error: "Faltan usuarioId y/o negocioId." });
    const negocio = exigirFeature(ctx, negocioId, "gestionUsuarios");
    exigirNegocio(ctx, negocioId, "admin");
    const usuario = await getUsuarioPorId(usuarioId);
    if (!usuario) return responderJson(res, 404, { error: "Usuario inexistente." });
    if (usuario.esSuperAdmin && !ctx.usuario.esSuperAdmin) return responderJson(res, 403, { error: "No podés modificar un superadmin." });

    if (req.method === "DELETE") {
      await borrarMembresia(usuarioId, negocioId);
      return responderJson(res, 200, { ok: true });
    }
    const existente = await getMembresia(usuarioId, negocioId);
    const actual = await contarUsuariosNegocio(negocioId);
    const limite = negocio.features?.maxAgentes;
    if (!existente && Number.isFinite(limite) && limite >= 0 && actual >= limite) {
      return responderJson(res, 409, { error: `El plan admite hasta ${limite} agentes.` });
    }
    await guardarMembresia(usuarioId, negocioId, req.body?.rol === "admin" ? "admin" : "agente");
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    return manejarError(res, error, "Error guardando la membresía.");
  }
}
