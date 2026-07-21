import { crearSesion, cookieDeSesion, verificarPassword } from "../../lib/auth.js";
import { getAgentePorUsuario } from "../../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.BACKOFFICE_SESSION_SECRET) {
    return res.status(500).json({ error: "Backoffice no configurado: falta BACKOFFICE_SESSION_SECRET." });
  }

  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: "Faltan usuario y/o contraseña." });

  try {
    const agente = await getAgentePorUsuario(String(usuario).trim().toLowerCase());
    if (!agente || !agente.activo || !verificarPassword(password, agente.passwordHash)) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }
    res.setHeader("Set-Cookie", cookieDeSesion(crearSesion(agente)));
    return res.status(200).json({ ok: true, agente: { id: agente.id, usuario: agente.usuario, nombre: agente.nombre } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error iniciando sesión" });
  }
}
