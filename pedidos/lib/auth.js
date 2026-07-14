// Dos formas de autenticación, ambas simples (el usuario final es un carnicero,
// no un desarrollador):
//
//  1. PIN del local (PEDIDOS_PIN) → sesión por cookie firmada con HMAC
//     (PEDIDOS_SESSION_SECRET). La usa la PWA en el navegador. Mismo mecanismo
//     que bot/lib/auth.js: el "token" es solo un vencimiento firmado, no hace
//     falta guardarlo en el servidor.
//  2. Token de API (PEDIDOS_API_TOKEN) → header Authorization: Bearer <token>.
//     Lo usa el bot (servidor a servidor) para crear pedidos con POST.
import crypto from "node:crypto";

const COOKIE = "pedidos_session";
const DURACION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días (una tablet en el mostrador no quiere re-loguear seguido)

function firmar(payload) {
  return crypto.createHmac("sha256", process.env.PEDIDOS_SESSION_SECRET || "").update(payload).digest("hex");
}

export function crearSesion() {
  const payload = String(Date.now() + DURACION_MS);
  return `${payload}.${firmar(payload)}`;
}

function sesionValida(token) {
  if (!token || !process.env.PEDIDOS_SESSION_SECRET) return false;
  const [payload, firma] = token.split(".");
  if (!payload || !firma) return false;
  const esperada = firmar(payload);
  if (esperada.length !== firma.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return false;
  return Number(payload) > Date.now();
}

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i === -1) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// ¿Está logueado el carnicero (cookie de PIN)?
export function estaAutenticado(req) {
  return sesionValida(parseCookies(req.headers?.cookie)[COOKIE]);
}

// ¿Es el bot (bearer token de API)? Comparación en tiempo constante.
export function esBot(req) {
  const esperado = process.env.PEDIDOS_API_TOKEN || "";
  if (!esperado) return false;
  const h = req.headers?.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const dado = m[1];
  if (dado.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(esperado));
}

export function cookieDeSesion(token) {
  const partes = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(DURACION_MS / 1000)}`];
  if (process.env.VERCEL) partes.push("Secure");
  return partes.join("; ");
}

export const COOKIE_LOGOUT = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
