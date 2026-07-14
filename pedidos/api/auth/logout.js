import { COOKIE_LOGOUT } from "../../lib/auth.js";

// POST /api/auth/logout  → borra la cookie de sesión.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Set-Cookie", COOKIE_LOGOUT);
  return res.status(200).json({ ok: true });
}
