import { exigirContexto, exigirNegocio, idsNegocios } from "../../lib/auth.js";
import { asignarConversacion, getConversacionAutorizada, listarUsuariosNegocio } from "../../lib/data.js";
import { enteroPositivo, manejarError, responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  try {
    const ctx = await exigirContexto(req);
    const id = enteroPositivo(req.body?.conversacionId);
    if (!id) return responderJson(res, 400, { error: "Falta conversacionId." });
    const conv = await getConversacionAutorizada(id, idsNegocios(ctx));
    const negocio = exigirNegocio(ctx, conv.negocioId);
    const destinoId = req.body?.usuarioId == null ? null : enteroPositivo(req.body.usuarioId);
    const esAdmin = ctx.usuario.esSuperAdmin || negocio.rol === "admin";

    if (!esAdmin) {
      const esPropiaOSinAsignar = conv.asignadoA == null || conv.asignadoA === ctx.usuario.id;
      const destinoPermitido = destinoId == null || destinoId === ctx.usuario.id;
      if (!esPropiaOSinAsignar || !destinoPermitido) return responderJson(res, 403, { error: "Solo podés tomar o liberar tus conversaciones." });
    }

    let destino = null;
    if (destinoId) {
      destino = (await listarUsuariosNegocio(conv.negocioId)).find((u) => u.id === destinoId);
      if (!destino) return responderJson(res, 400, { error: "El usuario no pertenece al negocio." });
    }
    await asignarConversacion(conv.id, conv.negocioId, destino ? { id: destino.id, nombre: destino.nombre || destino.usuario } : null);
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    return manejarError(res, error, "Error asignando la conversación.");
  }
}
