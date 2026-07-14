import { estaAutenticado } from "../../lib/auth.js";

// GET /api/auth/estado  → { autenticado: bool }. La PWA lo usa al abrir para
// decidir si muestra el teclado del PIN o va directo a la cola.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const configurado = !!(process.env.PEDIDOS_PIN && process.env.PEDIDOS_SESSION_SECRET);
  return res.status(200).json({ autenticado: estaAutenticado(req), configurado });
}
