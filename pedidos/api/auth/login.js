import { crearSesion, cookieDeSesion } from "../../lib/auth.js";
import crypto from "node:crypto";

// POST /api/auth/login  { pin }  → deja la cookie de sesión si el PIN coincide.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.PEDIDOS_PIN || !process.env.PEDIDOS_SESSION_SECRET) {
    return res.status(500).json({ error: "Falta configurar PEDIDOS_PIN / PEDIDOS_SESSION_SECRET." });
  }

  const pin = String((req.body || {}).pin || "");
  const esperado = String(process.env.PEDIDOS_PIN);
  const ok = pin.length === esperado.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(esperado));
  if (!ok) return res.status(401).json({ error: "PIN incorrecto." });

  res.setHeader("Set-Cookie", cookieDeSesion(crearSesion()));
  return res.status(200).json({ ok: true });
}
