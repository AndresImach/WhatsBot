import { createClient } from "@libsql/client";

let cliente;

function configuracion() {
  const url = process.env.CRM_TURSO_DATABASE_URL || "";
  const authToken = process.env.CRM_TURSO_AUTH_TOKEN || undefined;
  if (!url) throw new Error("Falta CRM_TURSO_DATABASE_URL.");
  return { url, authToken };
}

export function db() {
  if (!cliente) cliente = createClient(configuracion());
  return cliente;
}

export function resetDbForTests() {
  cliente?.close?.();
  cliente = undefined;
}

export async function ejecutar(sql, args = []) {
  return db().execute({ sql, args });
}

export async function filas(sql, args = []) {
  const resultado = await ejecutar(sql, args);
  return resultado.rows.map((row) => ({ ...row }));
}

export async function fila(sql, args = []) {
  return (await filas(sql, args))[0] || null;
}

export async function lote(sentencias, modo = "write") {
  return db().batch(
    sentencias.map((s) => (typeof s === "string" ? s : { sql: s.sql, args: s.args || [] })),
    modo
  );
}

export function placeholders(valores) {
  if (!Array.isArray(valores) || !valores.length) throw new Error("Se requiere al menos un valor para el scope.");
  return valores.map(() => "?").join(",");
}
