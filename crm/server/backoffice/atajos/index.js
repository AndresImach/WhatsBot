import { exigirContexto, exigirFeature, exigirNegocio } from "../../../lib/auth.js";
import { crearAtajo, listarAtajos } from "../../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo, texto } from "../../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, ["GET", "POST"])) return;
  try {
    const ctx = await exigirContexto(req);
    const negocioId = enteroPositivo(req.method === "GET" ? req.query?.negocioId : req.body?.negocioId);
    if (!negocioId) return responderJson(res, 400, { error: "Falta negocioId." });
    const negocio = exigirFeature(ctx, negocioId, "atajos");
    if (req.method === "GET") return responderJson(res, 200, { atajos: await listarAtajos(negocioId) });
    if (!ctx.usuario.esSuperAdmin && negocio.rol !== "admin") return responderJson(res, 403, { error: "Solo un admin puede gestionar atajos." });
    const clave = texto(req.body?.clave, 80);
    const contenido = texto(req.body?.texto, 4000);
    if (!clave || !contenido) return responderJson(res, 400, { error: "Faltan clave y/o texto." });
    exigirNegocio(ctx, negocioId, "admin");
    await crearAtajo(negocioId, clave, contenido);
    return responderJson(res, 201, { ok: true });
  } catch (error) {
    if (/UNIQUE/i.test(error?.message || "")) error.codigoPublico = "Ya existe un atajo con esa clave.";
    return manejarError(res, error, "Error procesando atajos.");
  }
}
