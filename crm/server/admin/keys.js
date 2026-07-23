import { exigirContexto, exigirSuperAdmin } from "../../lib/auth.js";
import { generarApiKey } from "../../lib/crypto.js";
import { crearBotApiKey, revocarBotApiKey } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, ["POST", "DELETE"])) return;
  try {
    const ctx = await exigirContexto(req);
    exigirSuperAdmin(ctx);
    if (req.method === "DELETE") {
      const id = enteroPositivo(req.body?.id);
      if (!id) return responderJson(res, 400, { error: "Id inválido." });
      await revocarBotApiKey(id);
      return responderJson(res, 200, { ok: true });
    }
    const negocioId = enteroPositivo(req.body?.negocioId);
    const nombre = texto(req.body?.nombre, 200);
    if (!negocioId || !nombre) return responderJson(res, 400, { error: "Faltan negocioId y/o nombre." });
    const generada = generarApiKey();
    const id = await crearBotApiKey({
      negocioId,
      nombre,
      keyHash: generada.hash,
      keySuffix: generada.suffix,
    });
    return responderJson(res, 201, { id, apiKey: generada.key });
  } catch (error) {
    return manejarError(res, error, "Error gestionando la API key.");
  }
}
