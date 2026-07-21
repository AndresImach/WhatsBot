-- Tablas para el "pivot a humano" del demo. Viven en la base LOG_TURSO
-- (la misma de "DemoChatLog", separada de cualquier base de un cliente real).
-- Correlo UNA VEZ:  turso db shell <tu-base-de-logs> < schema.sql

CREATE TABLE IF NOT EXISTS "DemoConversacion" (
  convId         TEXT PRIMARY KEY,
  negocio        TEXT,
  estado         TEXT NOT NULL DEFAULT 'bot', -- 'bot' | 'humano'
  asignadoA      INTEGER,           -- Agente.id que la tiene tomada (NULL = sin asignar)
  asignadoNombre TEXT,              -- denormalizado, como en bot/schema.sql
  etiquetas      TEXT,              -- "queja,vip" (comma-separated, sin espacios)
  valoracion     TEXT,              -- 'positiva' | 'negativa' | NULL: 👍/👎 del agente sobre si el bot resolvió bien la conversación
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "DemoMensaje" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  convId    TEXT NOT NULL,
  rol       TEXT NOT NULL, -- 'user' | 'assistant' | 'humano'
  contenido TEXT,
  ts        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_demomensaje_conv ON "DemoMensaje" (convId, id);

-- Notas internas por conversación: nunca las ve el widget del cliente ni
-- entran al historial que lee el modelo (solo "DemoMensaje" hace eso).
CREATE TABLE IF NOT EXISTS "DemoNota" (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  convId       TEXT NOT NULL,
  agenteId     INTEGER,
  agenteNombre TEXT,
  texto        TEXT NOT NULL,
  ts           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_demonota_conv ON "DemoNota" (convId, id);

-- Agentes del backoffice: reemplaza la contraseña única compartida
-- (BACKOFFICE_PASSWORD) por login individual. Se crean con:
--   node scripts/crear-agente.mjs <usuario> <password> ["Nombre para mostrar"]
CREATE TABLE IF NOT EXISTS "Agente" (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario      TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  nombre       TEXT,
  activo       INTEGER NOT NULL DEFAULT 1,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Respuestas rápidas ("canned responses") del compositor. "negocio" es
-- opcional: NULL = disponible en cualquier negocio, o una clave de
-- negocios.js (ej "sunstar") para que solo aparezca en ESE backoffice —
-- tiene sentido porque cada negocio del demo tiene un guion bien distinto.
CREATE TABLE IF NOT EXISTS "DemoAtajo" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio   TEXT,
  clave     TEXT NOT NULL,
  texto     TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── MIGRACIÓN (solo si ya tenías esta base de antes) ──────────────────────
-- Corré esto una vez (ignorá el error de cada línea si la columna ya existe):
--
-- ALTER TABLE "DemoConversacion" ADD COLUMN asignadoA INTEGER;
-- ALTER TABLE "DemoConversacion" ADD COLUMN asignadoNombre TEXT;
-- ALTER TABLE "DemoConversacion" ADD COLUMN etiquetas TEXT;
-- ALTER TABLE "DemoConversacion" ADD COLUMN valoracion TEXT;
