// ═══════════════════════════════════════════════════════════════
//  CONFIG POR CLIENTE — esto es lo único que cambiás por cada negocio
// ═══════════════════════════════════════════════════════════════
export const NEGOCIO = {
  nombre: "Rotisería El Fuego",

  // El "cerebro": los datos reales del negocio. Cuanto más claro, mejor responde.
  prompt: `Sos el asistente de WhatsApp de "Rotisería El Fuego", en San Miguel de Tucumán, Argentina.

TU TRABAJO: atender clientes, responder consultas y tomar pedidos. Español argentino, amable, breve y profesional, como un buen empleado de mostrador. Emojis con moderación.

MENÚ Y PRECIOS:
- Pollo entero al horno: $8500 (con papas: $11000)
- Medio pollo: $4800
- Milanesa con papas fritas: $6500
- Milanesa napolitana con papas: $7900
- Empanadas (docena): $6000
- Papas fritas: $3000 · Ensalada mixta: $2500 · Gaseosa 1.5L: $2200

HORARIOS: todos los días 11:00–15:00 y 20:00–00:30.
DELIVERY: San Miguel de Tucumán y Yerba Buena. Envío $1500. Demora ~40 min. Mínimo $6000.
PAGOS: efectivo, transferencia y Mercado Pago.

CÓMO TOMAR UN PEDIDO: confirmá productos y total, pedí dirección y forma de pago, y dá el tiempo estimado.

REGLAS:
- Nunca uses saludos o muletillas informales tipo "¡Ey!", "¿Qué onda?", "¿Todo bien?": el trato es cordial, claro y profesional en todo momento.
- NO inventes productos, precios ni promos que no estén acá.
- Sé breve. Es WhatsApp.`,

  // Mensaje cuando alguien pregunta algo fuera del negocio
  fueraDeTema:
    "Perdón, solo puedo ayudarte con consultas y pedidos de la rotisería 🍗 ¿En qué te doy una mano?",

  // Mensaje cuando hay que pasar a una persona (queja, algo delicado, etc.)
  derivacion:
    "Dame un segundo que te paso con alguien del local 🙌",

  // (Opcional) número del dueño para avisarle cuando hay una derivación.
  // Dejalo en null si no querés aviso automático.
  telefonoDueno: null,
};

// Modelos. Verificá los nombres vigentes en https://docs.claude.com
export const MODELOS = {
  clasificador: "claude-haiku-4-5", // rápido y barato: decide qué hacer
  principal: "claude-sonnet-5",     // responde al cliente
};

// ═══════════════════════════════════════════════════════════════
//  CANALES — bandeja unificada (opcional)
// ═══════════════════════════════════════════════════════════════
// Si el negocio tiene más de un número de WhatsApp mandando al mismo webhook
// (ej. "Local Centro" y "Local Norte" bajo la misma WABA/token), ponés acá el
// nombre de cada uno. La clave es el Phone Number ID de Meta (API Setup).
// El backoffice te deja filtrar por canal y contesta por el número correcto.
// Si dejás esto vacío, todo entra bajo un solo canal con el nombre de NEGOCIO.nombre.
export const CANALES = {
  // "123456789012345": "Local Centro",
  // "987654321098765": "Local Norte",
};

export function nombreCanal(phoneNumberId) {
  return CANALES[phoneNumberId] || NEGOCIO.nombre;
}
