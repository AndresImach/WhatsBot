import crypto from "node:crypto";
import { cargarContextoUsuario } from "./data.js";
import { errorPublico } from "./http.js";

const COOKIE = "crm_session";
const DURACION_MS = 1000 * 60 * 60 * 24 * 7;
const NIVEL_ROL = { agente: 1, admin: 2, superadmin: 3 };

function secretoSesion() {
  const secreto = process.env.CRM_SESSION_SECRET || "";
  if (secreto.length < 32) throw new Error("CRM_SESSION_SECRET debe tener al menos 32 caracteres.");
  return secreto;
}

function firmar(payload) {
  return crypto.createHmac("sha256", secretoSesion()).update(payload).digest("base64url");
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verificarPassword(password, almacenado) {
  const [salt, hash] = String(almacenado || "").split(":");
  if (!salt || !hash) return false;
  const calculado = crypto.scryptSync(String(password), salt, 64);
  const esperado = Buffer.from(hash, "hex");
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

export function crearSesion(usuarioId) {
  const payload = Buffer.from(JSON.stringify({ id: usuarioId, exp: Date.now() + DURACION_MS })).toString("base64url");
  return `${payload}.${firmar(payload)}`;
}

function decodificar(token) {
  if (!token) return null;
  const [payload, firma] = token.split(".");
  if (!payload || !firma) return null;
  const esperada = firmar(payload);
  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!datos.id || !datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

function cookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((parte) => parte.trim())
      .filter(Boolean)
      .map((parte) => {
        const i = parte.indexOf("=");
        return i === -1 ? [parte, ""] : [parte.slice(0, i), decodeURIComponent(parte.slice(i + 1))];
      })
  );
}

export async function contexto(req) {
  const token = cookies(req.headers?.cookie)[COOKIE];
  let sesion;
  try {
    sesion = decodificar(token);
  } catch {
    return null;
  }
  if (!sesion) return null;
  return cargarContextoUsuario(sesion.id);
}

export async function exigirContexto(req) {
  const ctx = await contexto(req);
  if (!ctx) throw errorPublico("No autorizado.", 401);
  return ctx;
}

export function negocioEnContexto(ctx, negocioId) {
  return ctx.negocios.find((n) => n.id === Number(negocioId)) || null;
}

export function exigirNegocio(ctx, negocioId, rolMinimo = "agente") {
  const negocio = negocioEnContexto(ctx, negocioId);
  if (!negocio) throw errorPublico("Negocio no autorizado.", 403);
  const rol = ctx.usuario.esSuperAdmin ? "superadmin" : negocio.rol;
  if ((NIVEL_ROL[rol] || 0) < (NIVEL_ROL[rolMinimo] || 0)) throw errorPublico("Permisos insuficientes.", 403);
  return negocio;
}

export function exigirSuperAdmin(ctx) {
  if (!ctx.usuario.esSuperAdmin) throw errorPublico("Se requiere superadmin.", 403);
}

export function idsNegocios(ctx, negocioId) {
  if (negocioId) {
    exigirNegocio(ctx, negocioId);
    return [Number(negocioId)];
  }
  const ids = ctx.negocios.map((n) => n.id);
  if (!ids.length) throw errorPublico("No tenés negocios asignados.", 403);
  return ids;
}

export function exigirFeature(ctx, negocioId, feature) {
  const negocio = exigirNegocio(ctx, negocioId);
  if (negocio.features?.[feature] !== true) throw errorPublico(`La función '${feature}' no está habilitada.`, 403);
  return negocio;
}

export function cookieSesion(token) {
  const partes = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(DURACION_MS / 1000)}`,
  ];
  if (process.env.VERCEL || process.env.NODE_ENV === "production") partes.push("Secure");
  return partes.join("; ");
}

export function cookieLogout() {
  const partes = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.VERCEL || process.env.NODE_ENV === "production") partes.push("Secure");
  return partes.join("; ");
}
