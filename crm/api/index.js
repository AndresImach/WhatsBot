import ingestMensaje from "../server/ingest/mensaje.js";
import ingestDerivar from "../server/ingest/derivar.js";
import login from "../server/backoffice/login.js";
import logout from "../server/backoffice/logout.js";
import yo from "../server/backoffice/yo.js";
import conversaciones from "../server/backoffice/conversaciones.js";
import mensajes from "../server/backoffice/mensajes.js";
import responder from "../server/backoffice/responder.js";
import resolver from "../server/backoffice/resolver.js";
import asignar from "../server/backoffice/asignar.js";
import etiquetas from "../server/backoffice/etiquetas.js";
import valoracion from "../server/backoffice/valoracion.js";
import notas from "../server/backoffice/notas.js";
import agentes from "../server/backoffice/agentes.js";
import atajos from "../server/backoffice/atajos/index.js";
import atajoPorId from "../server/backoffice/atajos/[id].js";
import adminEstado from "../server/admin/estado.js";
import adminNegocios from "../server/admin/negocios.js";
import adminUsuarios from "../server/admin/usuarios.js";
import adminMembresias from "../server/admin/membresias.js";
import adminCanales from "../server/admin/canales.js";
import adminKeys from "../server/admin/keys.js";
import adminFeatures from "../server/admin/features.js";

const RUTAS = new Map([
  ["ingest/mensaje", ingestMensaje],
  ["ingest/derivar", ingestDerivar],
  ["backoffice/login", login],
  ["backoffice/logout", logout],
  ["backoffice/yo", yo],
  ["backoffice/conversaciones", conversaciones],
  ["backoffice/mensajes", mensajes],
  ["backoffice/responder", responder],
  ["backoffice/resolver", resolver],
  ["backoffice/asignar", asignar],
  ["backoffice/etiquetas", etiquetas],
  ["backoffice/valoracion", valoracion],
  ["backoffice/notas", notas],
  ["backoffice/agentes", agentes],
  ["backoffice/atajos", atajos],
  ["admin/estado", adminEstado],
  ["admin/negocios", adminNegocios],
  ["admin/usuarios", adminUsuarios],
  ["admin/membresias", adminMembresias],
  ["admin/canales", adminCanales],
  ["admin/keys", adminKeys],
  ["admin/features", adminFeatures],
]);

export default async function handler(req, res) {
  const partes = Array.isArray(req.query?.ruta)
    ? req.query.ruta
    : String(req.query?.ruta || "").split("/").filter(Boolean);
  const ruta = partes.join("/");
  const atajo = ruta.match(/^backoffice\/atajos\/(\d+)$/);
  if (atajo) {
    req.query.id = atajo[1];
    return atajoPorId(req, res);
  }
  const destino = RUTAS.get(ruta);
  if (!destino) return res.status(404).json({ error: "Endpoint inexistente." });
  return destino(req, res);
}
