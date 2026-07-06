// Proxy serverless: recibe {system, messages} del navegador y llama a Claude.
// La API key NUNCA sale al cliente: vive en la variable de entorno ANTHROPIC_API_KEY.
//
// En Vercel: Settings → Environment Variables → ANTHROPIC_API_KEY = tu-key
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { system, messages } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages es requerido" });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: system || "",
        messages,
      }),
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno del proxy" });
  }
}
