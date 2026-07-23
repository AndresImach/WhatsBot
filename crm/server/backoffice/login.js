import { cookieSesion, crearSesion, verificarPassword } from "../../lib/auth.js";
import { getUsuarioPorNombre } from "../../lib/data.js";
import { manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const usuario = texto(req.body?.usuario, 100).toLowerCase();
    const password = String(req.body?.password || "");
    if (!usuario || !password) return responderJson(res, 400, { error: "Faltan usuario y/o contraseña." });
    const encontrado = await getUsuarioPorNombre(usuario);
    if (!encontrado || !encontrado.activo || !verificarPassword(password, encontrado.passwordHash)) {
      return responderJson(res, 401, { error: "Usuario o contraseña incorrectos." });
    }
    res.setHeader("Set-Cookie", cookieSesion(crearSesion(Number(encontrado.id))));
    return responderJson(res, 200, {
      ok: true,
      usuario: { id: Number(encontrado.id), usuario: encontrado.usuario, nombre: encontrado.nombre || encontrado.usuario },
    });
  } catch (error) {
    return manejarError(res, error, "Error iniciando sesión.");
  }
}
