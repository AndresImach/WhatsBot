import { crearSesion, cookieDeSesion } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.BACKOFFICE_PASSWORD || !process.env.BACKOFFICE_SESSION_SECRET) {
    return res.status(500).json({ error: "Backoffice no configurado: faltan BACKOFFICE_PASSWORD / BACKOFFICE_SESSION_SECRET." });
  }

  const { password } = req.body || {};
  if (password !== process.env.BACKOFFICE_PASSWORD) {
    return res.status(401).json({ error: "Contraseña incorrecta." });
  }

  res.setHeader("Set-Cookie", cookieDeSesion(crearSesion()));
  return res.status(200).json({ ok: true });
}
