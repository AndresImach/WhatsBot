import { autenticarBot, derivarPorNumero } from "../../lib/data.js";
import { manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

function bearer(req) {
  return String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const bot = await autenticarBot(bearer(req));
    if (!bot) return responderJson(res, 401, { error: "API key inválida o revocada." });
    const numero = texto(req.body?.numero, 80);
    if (!numero) return responderJson(res, 400, { error: "Falta numero." });
    await derivarPorNumero(bot.negocioId, numero);
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    return manejarError(res, error, "Error derivando la conversación.");
  }
}
