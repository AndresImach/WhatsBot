import crypto from "node:crypto";
import { ejecutarHerramientaTobias } from "../lib/tobias.js";

function autorizado(req) {
  const esperado = String(process.env.VERIFY_TOKEN || "");
  const recibido = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!esperado || esperado.length !== recibido.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recibido));
}

async function verificarCrm() {
  const base = String(process.env.CRM_API_URL || "").replace(/\/$/, "");
  const respuesta = await fetch(`${base}/api/ingest/derivar`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CRM_API_KEY || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ numero: "__healthcheck_sin_conversacion__" }),
  });
  // Una key válida llega a la consulta y devuelve 404 porque el número sintético
  // no existe. Una key ausente, errónea o revocada devuelve 401.
  return respuesta.status === 404;
}

async function verificarMeta() {
  const version = String(process.env.META_GRAPH_VERSION || "");
  const phoneNumberId = String(process.env.PHONE_NUMBER_ID || "");
  const respuesta = await fetch(
    `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}?fields=id`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN || ""}` } }
  );
  const data = await respuesta.json().catch(() => ({}));
  return respuesta.ok && String(data.id || "") === phoneNumberId;
}

async function verificarCatalogo() {
  const resultado = JSON.parse(
    await ejecutarHerramientaTobias("buscar_producto", {
      texto: "chocolate",
      limite: 1,
    })
  );
  return Array.isArray(resultado.resultados);
}

async function verificarOpenRouter() {
  const respuesta = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY || ""}` },
  });
  return respuesta.ok;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!autorizado(req)) return res.status(401).json({ error: "No autorizado" });

  const resultados = await Promise.allSettled([
    verificarCrm(),
    verificarMeta(),
    verificarCatalogo(),
    verificarOpenRouter(),
  ]);
  const [crm, meta, catalogo, openrouter] = resultados.map(
    (resultado) => resultado.status === "fulfilled" && resultado.value === true
  );
  const ok = crm && meta && catalogo && openrouter;
  return res.status(ok ? 200 : 503).json({
    ok,
    checks: { crm, meta, catalogo, openrouter },
  });
}
