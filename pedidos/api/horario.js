import { estaAutenticado, esBot } from "../lib/auth.js";
import { getHorario, setHorario } from "../lib/db.js";

const HHMM = /^\d{1,2}:\d{2}$/;

// GET /api/horario  → horario semanal (7 días). PIN o bot.
// PUT /api/horario  → guardar el horario completo (PIN).
export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!estaAutenticado(req) && !esBot(req)) return res.status(401).json({ error: "No autorizado" });
    try {
      return res.status(200).json({ horario: await getHorario() });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error leyendo el horario" });
    }
  }

  if (req.method === "PUT") {
    if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });
    try {
      const dias = Array.isArray(req.body?.horario) ? req.body.horario : null;
      if (!dias) return res.status(400).json({ error: "Falta 'horario' (array de días)" });
      for (const d of dias) {
        if (!Number.isInteger(d.dia) || d.dia < 0 || d.dia > 6) return res.status(400).json({ error: "Día inválido" });
        if (d.abierto) {
          if (!HHMM.test(d.apertura || "") || !HHMM.test(d.cierre || "")) {
            return res.status(400).json({ error: "Días abiertos necesitan apertura y cierre en formato HH:MM" });
          }
        }
      }
      return res.status(200).json({ horario: await setHorario(dias) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error guardando el horario" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
