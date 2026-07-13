-- Esquema del bot real (bot/). Correlo UNA VEZ contra tu base de Turso:
--   turso db shell <tu-base> < schema.sql
--
-- Guarda el historial de conversaciones (antes vivía en memoria, en webhook.js)
-- y el estado de cada una: 'bot' (responde el modelo) o 'humano' (una persona
-- la está atendiendo desde el backoffice y el bot no contesta).

CREATE TABLE IF NOT EXISTS "Conversacion" (
  numero    TEXT PRIMARY KEY,
  nombre    TEXT,
  estado    TEXT NOT NULL DEFAULT 'bot',
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "Mensaje" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  numero    TEXT NOT NULL,
  rol       TEXT NOT NULL, -- 'user' | 'assistant' | 'humano'
  contenido TEXT,
  ts        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mensaje_numero ON "Mensaje" (numero, id);
