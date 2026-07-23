import { exigirContexto, exigirFeature, exigirNegocio, exigirSuperAdmin, hashPassword } from "../../lib/auth.js";
import { crearUsuario, actualizarUsuario, getUsuarioPorNombre, guardarMembresia } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, ["POST", "PATCH"])) return;
  try {
    const ctx = await exigirContexto(req);
    if (req.method === "PATCH") {
      exigirSuperAdmin(ctx);
      const id = enteroPositivo(req.body?.id);
      const nombre = texto(req.body?.nombre, 200);
      const password = String(req.body?.password || "");
      if (!id || !nombre || (password && password.length < 10)) {
        return responderJson(res, 400, { error: "Datos inválidos; la contraseña nueva requiere 10 caracteres." });
      }
      await actualizarUsuario({
        id,
        nombre,
        activo: req.body?.activo !== false,
        esSuperAdmin: req.body?.esSuperAdmin === true,
        passwordHash: password ? hashPassword(password) : null,
      });
      return responderJson(res, 200, { ok: true });
    }

    const usuario = texto(req.body?.usuario, 100).toLowerCase();
    const nombre = texto(req.body?.nombre, 200) || usuario;
    const password = String(req.body?.password || "");
    const negocioId = enteroPositivo(req.body?.negocioId);
    const rol = req.body?.rol === "admin" ? "admin" : "agente";
    if (!usuario || password.length < 10) {
      return responderJson(res, 400, { error: "Se requiere usuario y una contraseña de al menos 10 caracteres." });
    }
    if (!ctx.usuario.esSuperAdmin) {
      if (!negocioId) return responderJson(res, 400, { error: "Falta negocioId." });
      exigirFeature(ctx, negocioId, "gestionUsuarios");
      exigirNegocio(ctx, negocioId, "admin");
    }
    if (await getUsuarioPorNombre(usuario)) {
      return responderJson(res, 409, { error: "Ese usuario ya existe; un superadmin debe asignarlo al negocio." });
    }
    const id = await crearUsuario({
      usuario,
      passwordHash: hashPassword(password),
      nombre,
      esSuperAdmin: ctx.usuario.esSuperAdmin && req.body?.esSuperAdmin === true,
    });
    if (negocioId) await guardarMembresia(id, negocioId, rol);
    return responderJson(res, 201, { id });
  } catch (error) {
    return manejarError(res, error, "Error guardando el usuario.");
  }
}
