import { NEGOCIO, MODELOS } from "./config.js";
import { formatearWhatsApp } from "./formato.js";
import { ejecutarHerramientaTobias, HERRAMIENTAS_TOBIAS } from "./tobias.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RONDAS_HERRAMIENTAS = 5;

const herramientasOpenAI = HERRAMIENTAS_TOBIAS.map((herramienta) => ({
  type: "function",
  function: {
    name: herramienta.name,
    description: herramienta.description,
    parameters: herramienta.input_schema,
  },
}));

async function llamarOpenRouter({ model, messages, tools, maxTokens = 1000 }) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("Falta OPENROUTER_API_KEY.");
  const respuesta = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.BOT_PUBLIC_URL || "https://whatsbot-crm.vercel.app",
      "X-Title": "Tobías Distribuciones WhatsBot",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      ...(tools?.length ? { tools } : {}),
    }),
  });
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(`OpenRouter respondió ${respuesta.status}.`);
    error.status = respuesta.status;
    throw error;
  }
  const mensaje = data.choices?.[0]?.message;
  if (!mensaje) throw new Error("OpenRouter no devolvió un mensaje.");
  return mensaje;
}

const SYSTEM_CLASIFICADOR = `Sos un clasificador para el WhatsApp de "${NEGOCIO.nombre}".
Leé el último mensaje del cliente y respondé con una sola categoría:
- responder: consulta normal sobre productos, precios, disponibilidad, locales o pedidos.
- fuera_de_tema: no tiene relación con Tobías ni sus productos.
- derivar: queja, reclamo, problema de pago/entrega o pedido explícito de hablar con una persona.
Respondé únicamente: responder, fuera_de_tema o derivar.`;

async function clasificar(messages) {
  const recientes = messages.slice(-4).map((mensaje) => ({
    role: mensaje.role === "assistant" ? "assistant" : "user",
    content: String(mensaje.content || ""),
  }));
  try {
    const mensaje = await llamarOpenRouter({
      model: MODELOS.clasificador,
      messages: [
        { role: "system", content: SYSTEM_CLASIFICADOR },
        ...recientes,
      ],
      maxTokens: 12,
    });
    const categoria = String(mensaje.content || "").toLowerCase();
    if (categoria.includes("fuera")) return "fuera_de_tema";
    if (categoria.includes("derivar")) return "derivar";
    return "responder";
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "llm_classifier_failed",
        status: error.status || null,
      })
    );
    return "derivar";
  }
}

async function responderNegocio(messages, contexto) {
  const conversacion = [
    { role: "system", content: NEGOCIO.prompt },
    ...messages.map((mensaje) => ({
      role: mensaje.role === "assistant" ? "assistant" : "user",
      content: String(mensaje.content || ""),
    })),
  ];

  for (let ronda = 0; ronda < MAX_RONDAS_HERRAMIENTAS; ronda += 1) {
    const mensaje = await llamarOpenRouter({
      model: MODELOS.principal,
      messages: conversacion,
      tools: herramientasOpenAI,
      maxTokens: 1200,
    });
    const llamadas = Array.isArray(mensaje.tool_calls) ? mensaje.tool_calls : [];
    if (!llamadas.length) return String(mensaje.content || "").trim();

    conversacion.push({
      role: "assistant",
      content: mensaje.content || null,
      tool_calls: llamadas,
    });
    for (const llamada of llamadas) {
      let input = {};
      try {
        input = JSON.parse(llamada.function?.arguments || "{}");
      } catch {
        input = {};
      }
      const resultado = await ejecutarHerramientaTobias(
        llamada.function?.name,
        input,
        contexto
      );
      conversacion.push({
        role: "tool",
        tool_call_id: llamada.id,
        content: resultado,
      });
    }
  }
  throw new Error("El modelo excedió el máximo de rondas de herramientas.");
}

export async function responder(messages, contexto = {}) {
  const categoria = await clasificar(messages);
  if (categoria === "fuera_de_tema") {
    return { texto: NEGOCIO.fueraDeTema, derivar: false };
  }
  if (categoria === "derivar") {
    return { texto: NEGOCIO.derivacion, derivar: true };
  }

  try {
    const texto = await responderNegocio(messages, contexto);
    return {
      texto: texto ? formatearWhatsApp(texto) : NEGOCIO.derivacion,
      derivar: !texto,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "llm_response_failed",
        status: error.status || null,
      })
    );
    return { texto: NEGOCIO.derivacion, derivar: true };
  }
}
