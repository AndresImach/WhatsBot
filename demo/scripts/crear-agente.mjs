// Crea o actualiza un agente del backoffice de demo/ (usuario + contraseña).
// Reemplaza la vieja BACKOFFICE_PASSWORD compartida: ahora cada persona que
// atiende conversaciones tiene su propio login.
//
// Uso (parado en demo/):
//   node scripts/crear-agente.mjs <usuario> <password> ["Nombre para mostrar"]
//
// Lee LOG_TURSO_DATABASE_URL / LOG_TURSO_AUTH_TOKEN de un .env en esta
// carpeta (si existe) o de variables ya exportadas en el shell. Ojo: es la
// base de LOGS (LOG_TURSO_*), no la de Tobías (TURSO_*).
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "../lib/auth.js";
import { crearOActualizarAgente } from "../lib/db.js";

function cargarEnv() {
  const ruta = path.join(process.cwd(), ".env");
  if (!fs.existsSync(ruta)) return;
  for (const linea of fs.readFileSync(ruta, "utf8").split("\n")) {
    const m = linea.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const clave = m[1];
    let valor = m[2] || "";
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (!(clave in process.env)) process.env[clave] = valor;
  }
}

async function main() {
  cargarEnv();
  const [usuario, password, nombre] = process.argv.slice(2);
  if (!usuario || !password) {
    console.error('Uso: node scripts/crear-agente.mjs <usuario> <password> ["Nombre"]');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("La contraseña necesita al menos 6 caracteres.");
    process.exit(1);
  }
  if (!process.env.LOG_TURSO_DATABASE_URL || !process.env.LOG_TURSO_AUTH_TOKEN) {
    console.error("Faltan LOG_TURSO_DATABASE_URL / LOG_TURSO_AUTH_TOKEN (poné un .env en demo/ o exportalas antes de correr esto).");
    process.exit(1);
  }

  const usuarioLimpio = usuario.trim().toLowerCase();
  await crearOActualizarAgente(usuarioLimpio, hashPassword(password), nombre || usuario);
  console.log(`Listo: agente "${usuarioLimpio}" creado/actualizado.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
