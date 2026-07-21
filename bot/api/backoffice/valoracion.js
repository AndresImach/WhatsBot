import { estaAutenticado } from "../../lib/auth.js";
import { setValoracion } from "../../lib/db.js";

const VALORES_VALIDOS = new Set(["positiva", "negativa", null]);

// POST { numero, valoracion: "positiva" | "negativa" | null } → guarda (o quita, con null) el 👍/👎 de la conversación.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  const { numero, valoracion } = req.body || {};
  const valor = valoracion ?? null;
  if (!numero) return res.status(400).json({ error: "Falta 'numero'." });
  if (!VALORES_VALIDOS.has(valor)) return res.status(400).json({ error: "'valoracion' debe ser 'positiva', 'negativa' o null." });

  try {
    await setValoracion(numero, valor);
    return res.status(200).json({ valoracion: valor });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error guardando la valoración" });
  }
}
