import { estaAutenticado } from "../../../lib/auth.js";
import { borrarAtajo } from "../../../lib/db.js";

// DELETE /api/backoffice/atajos/:id
export default async function handler(req, res) {
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });
  const id = Number(req.query?.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  if (req.method === "DELETE") {
    try {
      await borrarAtajo(id);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error borrando el atajo" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
