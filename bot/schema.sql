-- Esquema del bot real (bot/). Correlo UNA VEZ contra tu base de Turso:
--   turso db shell <tu-base> < schema.sql
--
-- Guarda el historial de conversaciones (antes vivía en memoria, en webhook.js)
-- y el estado de cada una: 'bot' (responde el modelo) o 'humano' (una persona
-- la está atendiendo desde el backoffice y el bot no contesta).

CREATE TABLE IF NOT EXISTS "Conversacion" (
  numero         TEXT PRIMARY KEY,
  nombre         TEXT,
  estado         TEXT NOT NULL DEFAULT 'bot',
  canal          TEXT,              -- phone_number_id de Meta por el que entró (bandeja unificada, ver CANALES en lib/config.js)
  canalNombre    TEXT,              -- nombre lindo del canal, denormalizado para no tener que resolverlo en cada lectura
  asignadoA      INTEGER,           -- Agente.id que la tiene tomada (NULL = sin asignar)
  asignadoNombre TEXT,              -- denormalizado, igual que canalNombre
  etiquetas      TEXT,              -- "queja,vip" (comma-separated, sin espacios)
  valoracion     TEXT,              -- 'positiva' | 'negativa' | NULL: 👍/👎 del agente sobre si el bot resolvió bien la conversación
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "Mensaje" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  numero    TEXT NOT NULL,
  rol       TEXT NOT NULL, -- 'user' | 'assistant' | 'humano'
  contenido TEXT,
  ts        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mensaje_numero ON "Mensaje" (numero, id);

-- Notas internas por conversación: a diferencia de "Mensaje", nunca se mandan
-- por WhatsApp ni entran al historial que lee el modelo (historialParaModelo).
CREATE TABLE IF NOT EXISTS "Nota" (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  numero       TEXT NOT NULL,
  agenteId     INTEGER,
  agenteNombre TEXT,
  texto        TEXT NOT NULL,
  ts           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nota_numero ON "Nota" (numero, id);

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

-- Respuestas rápidas ("canned responses") del compositor del backoffice.
CREATE TABLE IF NOT EXISTS "Atajo" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  clave     TEXT NOT NULL UNIQUE,
  texto     TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── MIGRACIÓN (solo si ya tenías esta base de antes) ──────────────────────
-- Las CREATE TABLE de arriba no tocan una "Conversacion" que ya existía sin
-- las columnas nuevas. Corré esto una vez (ignorá el error de cada línea si
-- la columna ya existe):
--
-- ALTER TABLE "Conversacion" ADD COLUMN canal TEXT;
-- ALTER TABLE "Conversacion" ADD COLUMN canalNombre TEXT;
-- ALTER TABLE "Conversacion" ADD COLUMN asignadoA INTEGER;
-- ALTER TABLE "Conversacion" ADD COLUMN asignadoNombre TEXT;
-- ALTER TABLE "Conversacion" ADD COLUMN etiquetas TEXT;
-- ALTER TABLE "Conversacion" ADD COLUMN valoracion TEXT;
