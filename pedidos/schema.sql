-- Esquema de la PWA de pedidos (pedidos/). Correlo UNA VEZ contra tu base de Turso:
--   turso db shell <tu-base> < schema.sql
--
-- Es la contraparte visual del bot: el bot arma el pedido con el cliente y lo
-- deja en estado 'pendiente'; el carnicero lo revisa acá y lo pasa a
-- 'confirmado_carnicero'; el bot lo cierra ('cerrado') cuando termina de hablar
-- con el cliente. Todas las horas se guardan en UTC (datetime('now')).

-- Lista plana de productos del local (sin variantes ni cortes por ahora).
CREATE TABLE IF NOT EXISTS "Catalogo" (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT    NOT NULL,
  unidad TEXT    NOT NULL DEFAULT 'unidad', -- 'kg' | 'g' | 'unidad'
  precio REAL,                              -- opcional
  activo INTEGER NOT NULL DEFAULT 1         -- 0/1
);

-- Un pedido que el bot tomó por WhatsApp.
CREATE TABLE IF NOT EXISTS "Pedido" (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_telefono TEXT,
  cliente_nombre   TEXT,
  estado           TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente | confirmado_carnicero | cerrado
  creado_en        TEXT    NOT NULL DEFAULT (datetime('now')),
  confirmado_en    TEXT,                                 -- cuándo lo confirmó el carnicero
  fuera_de_horario INTEGER NOT NULL DEFAULT 0,           -- 0/1: lo tomó el bot con el local cerrado
  nota             TEXT                                  -- comentario opcional del cliente
);

-- Cada ítem del pedido. Guarda un snapshot del nombre/unidad al momento del
-- pedido para que el historial no se rompa si después editás el catálogo.
CREATE TABLE IF NOT EXISTS "PedidoItem" (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id           INTEGER NOT NULL,
  catalogo_item_id    INTEGER,                            -- puede ser NULL (producto suelto)
  nombre              TEXT    NOT NULL,
  cantidad_pedida     REAL    NOT NULL,
  unidad              TEXT    NOT NULL DEFAULT 'unidad',
  estado_item         TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente | confirmado | no_disponible | editado
  cantidad_confirmada REAL                                -- solo si difiere de la pedida
);

-- Horario semanal del local. Una fila por día (0=domingo … 6=sábado, como getDay()).
CREATE TABLE IF NOT EXISTS "Horario" (
  dia      INTEGER PRIMARY KEY, -- 0..6
  abierto  INTEGER NOT NULL DEFAULT 0,
  apertura TEXT,                -- 'HH:MM'
  cierre   TEXT                 -- 'HH:MM'
);

CREATE INDEX IF NOT EXISTS idx_pedido_estado ON "Pedido" (estado, creado_en);
CREATE INDEX IF NOT EXISTS idx_item_pedido   ON "PedidoItem" (pedido_id);
