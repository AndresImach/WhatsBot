import { estaAutenticado } from "../../../lib/auth.js";
import { listarAtajos, crearAtajo } from "../../../lib/db.js";

// GET  /api/backoffice/atajos              → lista de respuestas rápidas
// POST /api/backoffice/atajos { clave, texto } → crear una
export default async function handler(req, res) {
  if (!estaAutenticado(req)) return res.status(401).json({ error: "No autorizado" });

  if (req.method === "GET") {
    try {
      return res.status(200).json({ atajos: await listarAtajos() });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error leyendo atajos" });
    }
  }

  if (req.method === "POST") {
    const { clave, texto } = req.body || {};
    const claveLimpia = String(clave || "").trim();
    const textoLimpio = String(texto || "").trim();
    if (!claveLimpia || !textoLimpio) return res.status(400).json({ error: "Faltan 'clave' y/o 'texto'." });
    try {
      await crearAtajo(claveLimpia, textoLimpio);
      return res.status(201).json({ ok: true });
    } catch (e) {
      console.error(e);
      const msg = /UNIQUE/i.test(e.message || "") ? "Ya existe un atajo con esa clave." : "Error creando el atajo";
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
