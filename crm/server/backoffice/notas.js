import { exigirContexto, exigirFeature, idsNegocios } from "../../lib/auth.js";
import { agregarNota, getConversacionAutorizada, listarNotas } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, ["GET", "POST"])) return;
  try {
    const ctx = await exigirContexto(req);
    const id = enteroPositivo(req.method === "GET" ? req.query?.conversacionId : req.body?.conversacionId);
    if (!id) return responderJson(res, 400, { error: "Falta conversacionId." });
    const conv = await getConversacionAutorizada(id, idsNegocios(ctx));
    exigirFeature(ctx, conv.negocioId, "notas");
    if (req.method === "GET") return responderJson(res, 200, { notas: await listarNotas(conv.id, conv.negocioId) });
    const contenido = texto(req.body?.texto, 5000);
    if (!contenido) return responderJson(res, 400, { error: "La nota está vacía." });
    await agregarNota(conv, ctx.usuario, contenido);
    return responderJson(res, 201, { ok: true });
  } catch (error) {
    return manejarError(res, error, "Error procesando notas.");
  }
}
