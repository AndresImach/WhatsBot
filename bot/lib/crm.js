import crypto from "node:crypto";

const PRESUPUESTO_MS = 2000;
const INTENTOS = 2;

function baseUrl() {
  const url = String(process.env.CRM_API_URL || "").replace(/\/$/, "");
  if (!url) throw new Error("Falta CRM_API_URL.");
  if (!process.env.CRM_API_KEY) throw new Error("Falta CRM_API_KEY.");
  return url;
}

function referenciaNumero(numero) {
  return crypto.createHash("sha256").update(String(numero || "")).digest("hex").slice(0, 12);
}

function logFallo({ etapa, messageId, numero, error }) {
  console.error(
    JSON.stringify({
      event: "crm_delivery_failed",
      etapa,
      messageId: messageId || null,
      contactoRef: referenciaNumero(numero),
      error: String(error?.message || error).slice(0, 180),
    })
  );
}

async function post(path, body) {
  const inicio = Date.now();
  let ultimoError;
  for (let intento = 0; intento < INTENTOS; intento += 1) {
    const restante = PRESUPUESTO_MS - (Date.now() - inicio);
    if (restante <= 0) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(50, restante));
    try {
      const respuesta = await fetch(`${baseUrl()}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CRM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await respuesta.json().catch(() => ({}));
      if (respuesta.ok) return data;
      const error = new Error(data.error || `CRM respondió ${respuesta.status}`);
      error.retryable = respuesta.status >= 500;
      throw error;
    } catch (error) {
      ultimoError = error;
      if (error.retryable === false) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw ultimoError || new Error("CRM no respondió dentro del presupuesto.");
}

export async function registrarMensajeSeguro(payload, metadata = {}) {
  try {
    return await post("/api/ingest/mensaje", payload);
  } catch (error) {
    logFallo({ ...metadata, numero: payload.numero, error });
    return null;
  }
}

export async function derivarSeguro(numero, metadata = {}) {
  try {
    return await post("/api/ingest/derivar", { numero });
  } catch (error) {
    logFallo({ ...metadata, numero, error });
    return null;
  }
}

export const CRM_TIMEOUT_MS = PRESUPUESTO_MS;
