// Convierte las construcciones Markdown que los modelos suelen producir al
// formato de texto que la API de WhatsApp interpreta de forma nativa.
function normalizarSalidaWhatsApp(texto) {
  return String(texto ?? "")
    .replace(/!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, etiqueta, url) =>
      `${etiqueta ? `${etiqueta}: ` : ""}${url}`
    )
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, etiqueta, url) =>
      `${etiqueta}: ${url}`
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
}

function normalizarContenidoWhatsApp(content) {
  if (!Array.isArray(content)) return content;
  return content.map((bloque) =>
    bloque?.type === "text"
      ? { ...bloque, text: normalizarSalidaWhatsApp(bloque.text) }
      : bloque
  );
}

export { normalizarContenidoWhatsApp, normalizarSalidaWhatsApp };
