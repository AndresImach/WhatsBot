-- Tablas para el "pivot a humano" del demo. Viven en la base LOG_TURSO
-- (la misma de "DemoChatLog", separada de cualquier base de un cliente real).
-- Correlo UNA VEZ:  turso db shell <tu-base-de-logs> < schema.sql

CREATE TABLE IF NOT EXISTS "DemoConversacion" (
  convId    TEXT PRIMARY KEY,
  negocio   TEXT,
  estado    TEXT NOT NULL DEFAULT 'bot', -- 'bot' | 'humano'
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "DemoMensaje" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  convId    TEXT NOT NULL,
  rol       TEXT NOT NULL, -- 'user' | 'assistant' | 'humano'
  contenido TEXT,
  ts        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_demomensaje_conv ON "DemoMensaje" (convId, id);
