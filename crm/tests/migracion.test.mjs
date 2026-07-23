import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";

test("migrar-negocio soporta dry-run y reejecución sin duplicados", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "whatsbot-crm-migration-"));
  const sourceUrl = `file:${path.join(dir, "source.db")}`;
  const targetUrl = `file:${path.join(dir, "target.db")}`;
  const source = createClient({ url: sourceUrl });
  for (const sql of [
    `CREATE TABLE "Conversacion" (numero TEXT PRIMARY KEY, nombre TEXT, estado TEXT, canal TEXT, canalNombre TEXT, asignadoA INTEGER, asignadoNombre TEXT, etiquetas TEXT, valoracion TEXT, updatedAt TEXT)`,
    `CREATE TABLE "Mensaje" (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, rol TEXT, contenido TEXT, ts TEXT)`,
    `CREATE TABLE "Nota" (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, agenteId INTEGER, agenteNombre TEXT, texto TEXT, ts TEXT)`,
    `CREATE TABLE "Agente" (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT UNIQUE, passwordHash TEXT, nombre TEXT, activo INTEGER, createdAt TEXT)`,
    `CREATE TABLE "Atajo" (id INTEGER PRIMARY KEY AUTOINCREMENT, clave TEXT UNIQUE, texto TEXT, createdAt TEXT)`,
    `INSERT INTO "Agente" (usuario, passwordHash, nombre, activo) VALUES ('vale', 'salt:hash', 'Valentina', 1)`,
    `INSERT INTO "Conversacion" (numero, nombre, estado, canal, asignadoA, asignadoNombre, etiquetas, updatedAt) VALUES ('5493811', 'Cliente', 'humano', 'phone-legacy', 1, 'Valentina', 'vip', datetime('now'))`,
    `INSERT INTO "Mensaje" (numero, rol, contenido, ts) VALUES ('5493811', 'user', 'Hola', datetime('now'))`,
    `INSERT INTO "Nota" (numero, agenteId, agenteNombre, texto, ts) VALUES ('5493811', 1, 'Valentina', 'Llamar mañana', datetime('now'))`,
    `INSERT INTO "Atajo" (clave, texto) VALUES ('horario', 'Abrimos de 9 a 18')`,
  ]) await source.execute(sql);
  source.close();

  const env = {
    ...process.env,
    CRM_TURSO_DATABASE_URL: targetUrl,
    SOURCE_TURSO_DATABASE_URL: sourceUrl,
    CRM_SESSION_SECRET: "migration-secret-with-at-least-32-characters",
    CRM_CRYPTO_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
  execFileSync(process.execPath, ["scripts/migrar-schema.mjs"], { cwd: process.cwd(), env });
  const target = createClient({ url: targetUrl });
  await target.execute(`INSERT INTO "Negocio" (clave, nombre, tier) VALUES ('piloto', 'Piloto', 'full')`);
  await target.execute(`INSERT INTO "Canal" (negocioId, phoneNumberId, nombre) SELECT id, 'phone-legacy', 'Principal' FROM "Negocio" WHERE clave = 'piloto'`);

  const dry = execFileSync(process.execPath, ["scripts/migrar-negocio.mjs", "--negocio", "piloto"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  assert.match(dry, /"dry-run"/);
  assert.match(dry, /Dry-run completo/);

  for (let i = 0; i < 2; i += 1) {
    execFileSync(process.execPath, ["scripts/migrar-negocio.mjs", "--negocio", "piloto", "--apply"], {
      cwd: process.cwd(),
      env,
    });
  }
  const counts = {};
  for (const tabla of ["Conversacion", "Mensaje", "Nota", "Usuario", "UsuarioNegocio", "Atajo"]) {
    const row = (await target.execute(`SELECT COUNT(*) AS cantidad FROM "${tabla}"`)).rows[0];
    counts[tabla] = Number(row.cantidad);
  }
  assert.deepEqual(counts, {
    Conversacion: 1,
    Mensaje: 1,
    Nota: 1,
    Usuario: 1,
    UsuarioNegocio: 1,
    Atajo: 1,
  });
  target.close();
  await fs.rm(dir, { recursive: true, force: true });
});
