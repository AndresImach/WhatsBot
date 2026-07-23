import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cargarEnv, argumentos } from "./_env.mjs";

cargarEnv();
const args = argumentos();
const { filas } = await import("../lib/client.js");

const tablas = await filas(
  `SELECT name, sql
     FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`
);
const datos = {};
for (const tabla of tablas) {
  const nombre = String(tabla.name);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre)) throw new Error(`Nombre de tabla inesperado: ${nombre}`);
  datos[nombre] = await filas(`SELECT * FROM "${nombre}"`);
}
const fecha = new Date().toISOString().replace(/[:.]/g, "-");
const salida = path.resolve(String(args.output || path.join(os.tmpdir(), `whatsbot-crm-backup-${fecha}.json`)));
await fs.writeFile(
  salida,
  JSON.stringify({ creadoEn: new Date().toISOString(), esquema: tablas, datos }, null, 2),
  { mode: 0o600 }
);
console.log(`Backup lógico creado en ${salida}`);
