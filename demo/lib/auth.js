// Sesión del backoffice: login individual por agente (tabla "Agente"), sin
// guardar sesiones en el servidor. El token es la identidad del agente +
// vencimiento, firmados con HMAC (BACKOFFICE_SESSION_SECRET) para que no se
// puedan falsificar sin conocer el secreto.
import crypto from "node:crypto";

const COOKIE = "bo_session";
const DURACION_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

function firmar(payload) {
  return crypto.createHmac("sha256", process.env.BACKOFFICE_SESSION_SECRET || "").update(payload).digest("hex");
}

// agente: { id, usuario, nombre }
export function crearSesion(agente) {
  const payload = Buffer.from(
    JSON.stringify({ id: agente.id, usuario: agente.usuario, nombre: agente.nombre || agente.usuario, exp: Date.now() + DURACION_MS })
  ).toString("base64url");
  return `${payload}.${firmar(payload)}`;
}

function decodificar(token) {
  if (!token || !process.env.BACKOFFICE_SESSION_SECRET) return null;
  const [payload, firma] = token.split(".");
  if (!payload || !firma) return null;
  const esperada = firmar(payload);
  if (esperada.length !== firma.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
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

// Datos del agente logueado ({id, usuario, nombre}) o null si no hay sesión válida.
export function agenteDeSesion(req) {
  return decodificar(parseCookies(req.headers?.cookie)[COOKIE]);
}

export function estaAutenticado(req) {
  return !!agenteDeSesion(req);
}

export function cookieDeSesion(token) {
  const partes = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(DURACION_MS / 1000)}`];
  if (process.env.VERCEL) partes.push("Secure");
  return partes.join("; ");
}

export const COOKIE_LOGOUT = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ── Contraseñas de agente (scrypt, sin dependencias) ──────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verificarPassword(password, almacenado) {
  const [salt, hash] = String(almacenado || "").split(":");
  if (!salt || !hash) return false;
  const calculado = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const bufA = Buffer.from(calculado, "hex");
  const bufB = Buffer.from(hash, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
