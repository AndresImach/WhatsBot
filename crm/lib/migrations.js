import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ejecutar, filas, lote } from "./client.js";

const DIR_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export function separarSentencias(sql) {
  return sql
    .split(";")
    .map((parte) => parte.trim())
    .filter(Boolean);
}

export async function aplicarMigraciones(directorio = DIR_DEFAULT) {
  await ejecutar(
    `CREATE TABLE IF NOT EXISTS "_migracion" (
       version INTEGER PRIMARY KEY,
       nombre TEXT NOT NULL,
       aplicadaEn TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  );
  const aplicadas = new Set((await filas('SELECT version FROM "_migracion"')).map((r) => Number(r.version)));
  const archivos = (await fs.readdir(directorio)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  const nuevas = [];
  for (const archivo of archivos) {
    const version = Number(archivo.match(/^(\d+)/)?.[1]);
    if (!Number.isInteger(version)) throw new Error(`Migración sin versión válida: ${archivo}`);
    if (aplicadas.has(version)) continue;
    const contenido = await fs.readFile(path.join(directorio, archivo), "utf8");
    const sentencias = separarSentencias(contenido).map((sql) => ({ sql }));
    sentencias.push({
      sql: 'INSERT INTO "_migracion" (version, nombre) VALUES (?, ?)',
      args: [version, archivo],
    });
    await lote(sentencias);
    nuevas.push({ version, archivo });
  }
  return nuevas;
}
