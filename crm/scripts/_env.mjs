import fs from "node:fs";
import path from "node:path";

export function cargarEnv() {
  for (const nombre of [".env", ".env.local"]) {
    const ruta = path.join(process.cwd(), nombre);
    if (!fs.existsSync(ruta)) continue;
    for (const linea of fs.readFileSync(ruta, "utf8").split("\n")) {
      const match = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let valor = match[2] || "";
      if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
        valor = valor.slice(1, -1);
      }
      if (!(match[1] in process.env)) process.env[match[1]] = valor;
    }
  }
}

export function argumentos(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const valor = argv[i];
    if (!valor.startsWith("--")) {
      out._.push(valor);
      continue;
    }
    const clave = valor.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[clave] = argv[++i];
    else out[clave] = true;
  }
  return out;
}
