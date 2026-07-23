CREATE TABLE IF NOT EXISTS "Negocio" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  clave     TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL,
  tier      TEXT NOT NULL DEFAULT 'full',
  activo    INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "BotApiKey" (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId  INTEGER NOT NULL REFERENCES "Negocio"(id),
  nombre     TEXT NOT NULL,
  keyHash    TEXT NOT NULL UNIQUE,
  keySuffix  TEXT NOT NULL,
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  lastUsedAt TEXT,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  revokedAt  TEXT
);
CREATE INDEX IF NOT EXISTS idx_bot_key_negocio ON "BotApiKey" (negocioId, activo);

CREATE TABLE IF NOT EXISTS "Canal" (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId     INTEGER NOT NULL REFERENCES "Negocio"(id),
  phoneNumberId TEXT NOT NULL UNIQUE,
  nombre        TEXT,
  tokenCifrado  TEXT,
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canal_negocio ON "Canal" (negocioId, activo);

CREATE TABLE IF NOT EXISTS "Usuario" (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario      TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  nombre       TEXT,
  esSuperAdmin INTEGER NOT NULL DEFAULT 0 CHECK (esSuperAdmin IN (0, 1)),
  activo       INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "UsuarioNegocio" (
  usuarioId INTEGER NOT NULL REFERENCES "Usuario"(id),
  negocioId INTEGER NOT NULL REFERENCES "Negocio"(id),
  rol       TEXT NOT NULL DEFAULT 'agente' CHECK (rol IN ('admin', 'agente')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuarioId, negocioId)
);
CREATE INDEX IF NOT EXISTS idx_un_negocio ON "UsuarioNegocio" (negocioId);

CREATE TABLE IF NOT EXISTS "Conversacion" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId      INTEGER NOT NULL REFERENCES "Negocio"(id),
  numero         TEXT NOT NULL,
  nombre         TEXT,
  estado         TEXT NOT NULL DEFAULT 'bot' CHECK (estado IN ('bot', 'humano')),
  canalId        INTEGER REFERENCES "Canal"(id),
  asignadoA      INTEGER REFERENCES "Usuario"(id),
  asignadoNombre TEXT,
  etiquetas      TEXT,
  valoracion     TEXT CHECK (valoracion IN ('positiva', 'negativa') OR valoracion IS NULL),
  datosExtra     TEXT,
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocioId, numero),
  UNIQUE (id, negocioId)
);
CREATE INDEX IF NOT EXISTS idx_conv_bandeja ON "Conversacion" (negocioId, estado, updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_conv_asignado ON "Conversacion" (negocioId, asignadoA, updatedAt DESC);

CREATE TABLE IF NOT EXISTS "Mensaje" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacionId INTEGER NOT NULL,
  negocioId      INTEGER NOT NULL,
  rol            TEXT NOT NULL CHECK (rol IN ('user', 'assistant', 'humano')),
  contenido      TEXT,
  idExterno      TEXT,
  ts             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversacionId, negocioId) REFERENCES "Conversacion"(id, negocioId)
);
CREATE INDEX IF NOT EXISTS idx_msj_conv ON "Mensaje" (conversacionId, id);
CREATE INDEX IF NOT EXISTS idx_msj_negocio ON "Mensaje" (negocioId, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_msj_externo
  ON "Mensaje" (negocioId, idExterno) WHERE idExterno IS NOT NULL;

CREATE TABLE IF NOT EXISTS "Nota" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacionId INTEGER NOT NULL,
  negocioId      INTEGER NOT NULL,
  usuarioId      INTEGER REFERENCES "Usuario"(id),
  usuarioNombre  TEXT,
  texto          TEXT NOT NULL,
  ts             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversacionId, negocioId) REFERENCES "Conversacion"(id, negocioId)
);
CREATE INDEX IF NOT EXISTS idx_nota_conv ON "Nota" (conversacionId, id);
CREATE INDEX IF NOT EXISTS idx_nota_negocio ON "Nota" (negocioId, id);

CREATE TABLE IF NOT EXISTS "Atajo" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId INTEGER REFERENCES "Negocio"(id),
  clave     TEXT NOT NULL,
  texto     TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atajo_negocio
  ON "Atajo" (negocioId, clave) WHERE negocioId IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_atajo_global
  ON "Atajo" (clave) WHERE negocioId IS NULL;

CREATE TABLE IF NOT EXISTS "PlanFeature" (
  tier    TEXT NOT NULL,
  feature TEXT NOT NULL,
  valor   TEXT NOT NULL,
  PRIMARY KEY (tier, feature)
);

CREATE TABLE IF NOT EXISTS "NegocioFeature" (
  negocioId INTEGER NOT NULL REFERENCES "Negocio"(id),
  feature   TEXT NOT NULL,
  valor     TEXT NOT NULL,
  PRIMARY KEY (negocioId, feature)
);

CREATE TABLE IF NOT EXISTS "_importacion_legacy" (
  origen    TEXT NOT NULL,
  entidad   TEXT NOT NULL,
  sourceId  TEXT NOT NULL,
  targetId  INTEGER,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (origen, entidad, sourceId)
);

INSERT INTO "PlanFeature" (tier, feature, valor) VALUES
  ('full', 'etiquetas', 'true'),
  ('full', 'notas', 'true'),
  ('full', 'valoracion', 'true'),
  ('full', 'atajos', 'true'),
  ('full', 'gestionUsuarios', 'true'),
  ('full', 'maxAgentes', 'unlimited')
ON CONFLICT(tier, feature) DO NOTHING;
