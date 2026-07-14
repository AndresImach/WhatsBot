import { estaAutenticado, esBot } from "../../lib/auth.js";
import { getPedido, actualizarItem, confirmarPedido, setEstadoPedido } from "../../lib/db.js";

// GET   /api/pedidos/:id  → detalle de un pedido (PIN)
// PATCH /api/pedidos/:id  → confirmar/editar ítems y cerrar la revisión (PIN),
//                           o que el bot lo pase a 'cerrado' (Bearer token).
//
// Cuerpos aceptados en PATCH:
//   { item: { id, estado_item, cantidad_confirmada? } }  → actualiza un ítem
//   { confirmar: true }                                  → estado = confirmado_carnicero
//   { estado: "cerrado" }                                → lo usa el bot al terminar
export default async function handler(req, res) {
  const id = Number(req.query?.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  const esCarnicero = estaAutenticado(req);
  const bot = esBot(req);
  if (!esCarnicero && !bot) return res.status(401).json({ error: "No autorizado" });

  if (req.method === "GET") {
    if (!esCarnicero) return res.status(401).json({ error: "No autorizado" });
    const pedido = await getPedido(id);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    return res.status(200).json({ pedido });
  }

  if (req.method === "PATCH") {
    try {
      const existe = await getPedido(id);
      if (!existe) return res.status(404).json({ error: "Pedido no encontrado" });
      const body = req.body || {};

      // El bot solo puede cambiar el estado (típicamente a 'cerrado').
      if (bot && !esCarnicero) {
        if (!body.estado) return res.status(400).json({ error: "Falta 'estado'" });
        const pedido = await setEstadoPedido(id, body.estado);
        return res.status(200).json({ pedido });
      }

      // Carnicero: puede tocar un ítem y/o confirmar el pedido en la misma llamada.
      if (body.item) {
        const { id: itemId, estado_item, cantidad_confirmada } = body.item;
        const validos = ["pendiente", "confirmado", "no_disponible", "editado"];
        if (!Number.isInteger(Number(itemId)) || !validos.includes(estado_item)) {
          return res.status(400).json({ error: "Ítem inválido" });
        }
        if (estado_item === "editado" && !(Number(cantidad_confirmada) > 0)) {
          return res.status(400).json({ error: "La cantidad editada tiene que ser mayor a 0" });
        }
        await actualizarItem(id, { id: Number(itemId), estado_item, cantidad_confirmada });
      }

      if (body.confirmar) {
        const pedido = await confirmarPedido(id);
        return res.status(200).json({ pedido });
      }
      if (body.estado) {
        const pedido = await setEstadoPedido(id, body.estado);
        return res.status(200).json({ pedido });
      }

      return res.status(200).json({ pedido: await getPedido(id) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error actualizando el pedido" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
