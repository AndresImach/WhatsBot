function celdasTabla(linea) {
  return linea
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((celda) => celda.trim());
}

function esSeparadorTabla(linea) {
  const celdas = celdasTabla(linea);
  return celdas.length > 0 && celdas.every((celda) => /^:?-{3,}:?$/.test(celda));
}

export function formatearWhatsApp(texto) {
  const lineas = String(texto || "").split("\n");
  const salida = [];
  for (let indice = 0; indice < lineas.length; indice += 1) {
    const linea = lineas[indice];
    if (
      linea.trim().startsWith("|") &&
      lineas[indice + 1]?.trim().startsWith("|") &&
      esSeparadorTabla(lineas[indice + 1])
    ) {
      indice += 2;
      while (indice < lineas.length && lineas[indice].trim().startsWith("|")) {
        const celdas = celdasTabla(lineas[indice]).filter(Boolean);
        if (celdas.length) salida.push(`• ${celdas.join(" — ")}`);
        indice += 1;
      }
      indice -= 1;
      continue;
    }
    salida.push(linea.replace(/^#{1,6}\s+/, ""));
  }

  return salida
    .join("\n")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
