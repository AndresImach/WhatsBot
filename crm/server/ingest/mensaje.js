import { autenticarBot, ingestarMensaje } from "../../lib/data.js";
import { manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

function bearer(req) {
  const match = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const bot = await autenticarBot(bearer(req));
    if (!bot) return responderJson(res, 401, { error: "API key inválida o revocada." });

    const body = req.body || {};
    const numero = texto(body.numero, 80);
    const contenido = texto(body.contenido, 16000);
    const rol = texto(body.rol, 20);
    if (!numero || !contenido || !["user", "assistant"].includes(rol)) {
      return responderJson(res, 400, { error: "Se requieren numero, contenido y rol user|assistant." });
    }

    const resultado = await ingestarMensaje(bot.negocioId, {
      numero,
      nombre: texto(body.nombre, 200) || null,
      phoneNumberId: texto(body.phoneNumberId, 100) || null,
      rol,
      contenido,
      idExterno: texto(body.idExterno, 300) || null,
      derivar: body.derivar === true,
    });
    return responderJson(res, 200, resultado);
  } catch (error) {
    return manejarError(res, error, "Error registrando el mensaje.");
  }
}
