// Proxy serverless: recibe {system, messages, cineId} del navegador y llama a Claude.
// La API key NUNCA sale al cliente: vive en la variable de entorno ANTHROPIC_API_KEY.
//
// Si viene "cineId", se habilitan HERRAMIENTAS (tool use) para que el asistente
// consulte precio y disponibilidad reales de una función puntual del cine, en vivo.
// El servidor ejecuta la herramienta contra la API del cine y le devuelve el
// resultado al modelo, en un loop, hasta que produce la respuesta final.
//
// En Vercel: Settings → Environment Variables → ANTHROPIC_API_KEY = tu-key
const CINE_API = "https://apiv2.gaf.adro.studio";
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 4;

// Herramienta que ve el modelo.
const TOOL_CONSULTAR = {
  name: "consultar_funcion",
  description:
    "Devuelve el PRECIO de las entradas y la DISPONIBILIDAD (butacas libres y vendidas) de una función puntual del cine, en tiempo real. " +
    "Usá el 'ref' y el 'formato' que figuran en la tabla interna de FUNCIONES de la cartelera. " +
    "Llamala cuando el usuario pregunte por precio, cuánto sale, o si quedan lugares para una función concreta.",
  input_schema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "El identificador 'ref' de la función (última columna de la tabla de FUNCIONES)." },
      formato: { type: "string", description: "Formato de la función: '2D' o '3D'." },
    },
    required: ["ref", "formato"],
  },
};

// Ejecuta la herramienta contra la API real del cine.
async function ejecutarConsultarFuncion(cineId, input) {
  const ref = String(input?.ref || "").trim();
  const formato = String(input?.formato || "2D").trim() || "2D";
  if (!ref) return JSON.stringify({ error: "Falta el 'ref' de la función." });
  try {
    const r = await fetch(`${CINE_API}/tickets/${cineId}/${encodeURIComponent(ref)}/${encodeURIComponent(formato)}`);
    const d = await r.json();
    if (d.status !== "ok") return JSON.stringify({ error: "No se encontró la función." });
    const precios = (d.tickets || []).map((t) => ({
      tipo: String(t.detalle || "").replace(/\*/g, "").trim() || "Entrada",
      precio: Number(t.precio),
    }));
    return JSON.stringify({
      pelicula: d.movie?.nombre,
      sala: d.movie?.sala,
      fechaHora: d.movie?.fechaHora?.date ? d.movie.fechaHora.date.slice(0, 16) : null,
      precios,
      disponibles: d.disponibles,
      vendidas: d.vendidas,
    });
  } catch (e) {
    return JSON.stringify({ error: "No se pudo consultar la función en este momento." });
  }
}

async function llamarClaude({ system, messages, tools }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: system || "",
      messages,
      ...(tools ? { tools } : {}),
    }),
  });
  return { status: r.status, data: await r.json() };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { system, messages, cineId } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages es requerido" });
    }

    const tools = cineId ? [TOOL_CONSULTAR] : undefined;
    const convo = messages.slice();

    // Loop de herramientas: si no hay cineId, tools es undefined y sale en la 1ª vuelta.
    for (let ronda = 0; ronda <= MAX_TOOL_ROUNDS; ronda++) {
      const { status, data } = await llamarClaude({ system, messages: convo, tools });
      if (status !== 200) return res.status(status).json(data);

      if (data.stop_reason !== "tool_use") {
        return res.status(200).json(data); // respuesta final
      }

      // Ejecutamos cada herramienta pedida y devolvemos los resultados al modelo.
      convo.push({ role: "assistant", content: data.content });
      const resultados = [];
      for (const bloque of data.content) {
        if (bloque.type === "tool_use") {
          let out = JSON.stringify({ error: "Herramienta desconocida." });
          if (bloque.name === "consultar_funcion") {
            out = await ejecutarConsultarFuncion(cineId, bloque.input);
          }
          resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: out });
        }
      }
      convo.push({ role: "user", content: resultados });
    }

    // Si se agotaron las rondas, pedimos una respuesta final sin herramientas.
    const { status, data } = await llamarClaude({ system, messages: convo });
    return res.status(status).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno del proxy" });
  }
}
