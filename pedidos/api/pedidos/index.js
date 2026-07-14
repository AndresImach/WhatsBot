import { estaAutenticado, esBot } from "../../lib/auth.js";
import { crearPedido, listarPedidos, getHorario } from "../../lib/db.js";
import { estaFueraDeHorario } from "../../lib/horario.js";

// GET  /api/pedidos?estado=pendiente        → la PWA pollea la cola (necesita PIN)
// GET  /api/pedidos?estado=cerrado&desde=…  → historial
// POST /api/pedidos                         → el bot crea un pedido (necesita Bearer token)
export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });
    try {
      const { estado, desde, hasta } = req.query || {};
      const pedidos = await listarPedidos({ estado, desde, hasta });
      return res.status(200).json({ pedidos });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error leyendo pedidos" });
    }
  }

  if (req.method === "POST") {
    if (!esBot(req)) return res.status(401).json({ error: "No autorizado (falta Bearer token del bot)" });
    try {
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return res.status(400).json({ error: "El pedido necesita al menos un ítem" });
      for (const it of items) {
        if (!it || !it.nombre || !(Number(it.cantidad_pedida) > 0)) {
          return res.status(400).json({ error: "Cada ítem necesita 'nombre' y 'cantidad_pedida' > 0" });
        }
      }
      // El bot puede mandar fuera_de_horario explícito; si no, lo calculamos con
      // el horario cargado en esta PWA (única fuente de verdad).
      let fuera = body.fuera_de_horario;
      if (fuera === undefined) fuera = estaFueraDeHorario(await getHorario());

      const pedido = await crearPedido({
        cliente_telefono: body.cliente_telefono,
        cliente_nombre: body.cliente_nombre,
        fuera_de_horario: fuera,
        nota: body.nota,
        items,
      });
      return res.status(201).json({ pedido });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error creando el pedido" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
