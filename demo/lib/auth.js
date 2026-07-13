// Sesión del backoffice: una sola contraseña compartida (BACKOFFICE_PASSWORD),
// sin usuarios ni base de datos de sesiones. El "token" es solo un vencimiento
// firmado con HMAC (BACKOFFICE_SESSION_SECRET) para que no se pueda falsificar
// sin conocer el secreto; no hace falta guardarlo en ningún lado del servidor.
import crypto from "node:crypto";

const COOKIE = "bo_session";
const DURACION_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

function firmar(payload) {
  return crypto.createHmac("sha256", process.env.BACKOFFICE_SESSION_SECRET || "").update(payload).digest("hex");
}

export function crearSesion() {
  const payload = String(Date.now() + DURACION_MS);
  return `${payload}.${firmar(payload)}`;
}

function sesionValida(token) {
  if (!token || !process.env.BACKOFFICE_SESSION_SECRET) return false;
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

export function estaAutenticado(req) {
  return sesionValida(parseCookies(req.headers?.cookie)[COOKIE]);
}

export function cookieDeSesion(token) {
  const partes = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(DURACION_MS / 1000)}`];
  if (process.env.VERCEL) partes.push("Secure");
  return partes.join("; ");
}

export const COOKIE_LOGOUT = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
