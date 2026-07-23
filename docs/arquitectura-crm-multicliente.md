# Arquitectura: bots por negocio + CRM unificado multi-cliente

Base central: **`whatsbot-demo-logs`** (Turso/libSQL). Las tablas nuevas del CRM
conviven con las `Demo*` existentes sin conflicto de nombres; cuando el CRM esté
andando, las `Demo*` se migran y se borran (ver §6).

---

## 1. Vista general

```
┌─────────────────┐   HTTPS + API key del negocio
│ Bot Tobías      │──────────────────┐
│ (Vercel, WABA A)│                  ▼
├─────────────────┤        ┌───────────────────┐        ┌──────────────────┐
│ Bot Carnicería  │───────▶│  CRM unificado    │◀──────▶│  Base central    │
│ (Vercel, WABA B)│        │  (UN deploy       │  SQL   │  Turso           │
├─────────────────┤        │   Vercel)         │        │  whatsbot-demo-  │
│ Bot Cine        │───────▶│  /api/ingest      │        │  logs            │
│ (Vercel, WABA C)│        │  /api/backoffice  │        └──────────────────┘
└─────────────────┘        └─────────┬─────────┘
        ▲                            │ Graph API (token por canal,
        │ webhook de Meta            │ guardado en la base central)
   WhatsApp Cloud API ◀──────────────┘  ← respuestas de agentes humanos
```

**Decisión clave: los bots NO tocan la base central directamente.** Hablan con
el CRM por HTTP con una API key propia de cada negocio (mismo patrón que ya
usás entre el bot de carnicería y la PWA de `pedidos/`: `PEDIDOS_API_URL` +
Bearer token). El motivo es de seguridad, no de gusto: un token de Turso da
acceso a **toda** la base — no existe scoping por fila — así que un bug en un
bot con acceso SQL directo podría leer/escribir conversaciones de otro negocio.
Con la API en el medio, el `negocioId` **lo deduce el servidor a partir de la
API key**; el bot nunca lo manda, así que no puede equivocarse de tenant ni a
propósito.

*Alternativa descartada:* cada bot con `LOG_TURSO_*` + `NEGOCIO_ID` en env vars
y escritura SQL directa. Menos piezas y menos latencia (un hop menos), pero la
frontera entre tenants pasa a ser una convención ("acordate de filtrar por
negocioId") en N repos deployados por separado. Con la API es una garantía en
un solo lugar. Si algún día la latencia del hop molesta, se revisa; hoy el hop
CRM→Turso ya existe igual.

---

## 2. Esquema de base de datos

```sql
-- ══ Tenancy ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Negocio" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  clave     TEXT NOT NULL UNIQUE,   -- slug corto: 'tobias', 'carniceria' (para URLs ?n=)
  nombre    TEXT NOT NULL,
  tier      TEXT NOT NULL DEFAULT 'base',  -- FK lógica a PlanFeature.tier
  activo    INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API keys de los bots. Tabla aparte (y no una columna en Negocio) para poder
-- rotar sin downtime: creás la key nueva, actualizás la env var del bot,
-- desactivás la vieja.
CREATE TABLE IF NOT EXISTS "BotApiKey" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId INTEGER NOT NULL REFERENCES "Negocio"(id),
  keyHash   TEXT NOT NULL UNIQUE,   -- sha256 de la key; la key en claro solo la ve el bot
  activo    INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Canales de WhatsApp del negocio (1..N phone numbers, como CANALES de hoy).
-- El CRM necesita el token para responder por Graph API cuando un agente
-- escribe. tokenCifrado: cifrado con una key simétrica en env var del CRM
-- (CRM_CRYPTO_KEY), no en claro en la base.
CREATE TABLE IF NOT EXISTS "Canal" (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId     INTEGER NOT NULL REFERENCES "Negocio"(id),
  phoneNumberId TEXT NOT NULL UNIQUE,  -- el de Meta; identifica el canal globalmente
  nombre        TEXT,                  -- "Local Centro", "Local Norte"
  tokenCifrado  TEXT,
  activo        INTEGER NOT NULL DEFAULT 1
);

-- ══ Usuarios y permisos ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Usuario" (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario      TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,          -- mismo scrypt de bot/lib/auth.js
  nombre       TEXT,
  esSuperAdmin INTEGER NOT NULL DEFAULT 0,  -- vos: ve todo, administra negocios
  activo       INTEGER NOT NULL DEFAULT 1,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Puente muchos-a-muchos con rol POR negocio.
CREATE TABLE IF NOT EXISTS "UsuarioNegocio" (
  usuarioId INTEGER NOT NULL REFERENCES "Usuario"(id),
  negocioId INTEGER NOT NULL REFERENCES "Negocio"(id),
  rol       TEXT NOT NULL DEFAULT 'agente',  -- 'admin' | 'agente'
  PRIMARY KEY (usuarioId, negocioId)
);
CREATE INDEX IF NOT EXISTS idx_un_negocio ON "UsuarioNegocio" (negocioId);

-- ══ Conversaciones ═══════════════════════════════════════════════════════

-- El PK deja de ser `numero` (un mismo teléfono puede escribirle a dos
-- negocios distintos): pasa a id sintético + UNIQUE(negocioId, numero).
CREATE TABLE IF NOT EXISTS "Conversacion" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId      INTEGER NOT NULL REFERENCES "Negocio"(id),
  numero         TEXT NOT NULL,
  nombre         TEXT,
  estado         TEXT NOT NULL DEFAULT 'bot',   -- 'bot' | 'humano'
  canalId        INTEGER REFERENCES "Canal"(id),
  asignadoA      INTEGER REFERENCES "Usuario"(id),
  asignadoNombre TEXT,                          -- denormalizado, como hoy
  etiquetas      TEXT,                          -- "queja,vip" como hoy
  valoracion     TEXT,                          -- 'positiva' | 'negativa' | NULL
  datosExtra     TEXT,                          -- JSON libre por negocio (ver §5, campos custom)
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocioId, numero)
);
CREATE INDEX IF NOT EXISTS idx_conv_bandeja ON "Conversacion" (negocioId, estado, updatedAt DESC);

CREATE TABLE IF NOT EXISTS "Mensaje" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacionId INTEGER NOT NULL REFERENCES "Conversacion"(id),
  negocioId      INTEGER NOT NULL,  -- redundante a propósito: defensa en profundidad (§3)
  rol            TEXT NOT NULL,     -- 'user' | 'assistant' | 'humano'
  contenido      TEXT,
  ts             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msj_conv ON "Mensaje" (conversacionId, id);

CREATE TABLE IF NOT EXISTS "Nota" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacionId INTEGER NOT NULL REFERENCES "Conversacion"(id),
  negocioId      INTEGER NOT NULL,
  usuarioId      INTEGER REFERENCES "Usuario"(id),
  usuarioNombre  TEXT,
  texto          TEXT NOT NULL,
  ts             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nota_conv ON "Nota" (conversacionId, id);

-- Respuestas rápidas: negocioId NULL = global (visible en todos los negocios),
-- como ya hace demo/ con DemoAtajo.negocio.
CREATE TABLE IF NOT EXISTS "Atajo" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  negocioId INTEGER REFERENCES "Negocio"(id),   -- NULL = global
  clave     TEXT NOT NULL,
  texto     TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocioId, clave)
);

-- ══ Tiers / features (§5) ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "PlanFeature" (
  tier    TEXT NOT NULL,     -- 'base' | 'pro' | 'full' (los que definas)
  feature TEXT NOT NULL,     -- 'maxAgentes', 'etiquetas', 'notas', 'valoracion', ...
  valor   TEXT NOT NULL,     -- '3', 'true'... (el helper castea)
  PRIMARY KEY (tier, feature)
);

-- Excepción puntual por negocio SIN tocar código ni inventar un tier nuevo
-- ("a este cliente le regalo etiquetas aunque esté en base"):
CREATE TABLE IF NOT EXISTS "NegocioFeature" (
  negocioId INTEGER NOT NULL REFERENCES "Negocio"(id),
  feature   TEXT NOT NULL,
  valor     TEXT NOT NULL,
  PRIMARY KEY (negocioId, feature)
);
```

Notas sobre el modelado:

- **`Mensaje.negocioId` y `Nota.negocioId` son redundantes** (se deducen vía
  `conversacionId`) y están a propósito: permiten que *toda* query del backend
  filtre por `negocioId` directo, sin depender de que el JOIN esté bien hecho.
  Es el cinturón y tiradores del multi-tenant.
- **`asignadoNombre` / `usuarioNombre` denormalizados** se mantienen como hoy:
  la bandeja lista sin JOINs y el nombre queda "congelado" históricamente.
- **`canalId`** reemplaza al par `canal`/`canalNombre` de hoy: el nombre lindo
  vive una sola vez en `Canal`, y `CANALES` deja de existir en `config.js` —
  pasa a ser data administrable desde el CRM.

---

## 3. Autenticación y autorización del CRM

**Sesión: cookie firmada con solo `usuarioId` + expiración.** Mismo esquema
HMAC de `bot/lib/auth.js` (`CRM_SESSION_SECRET`). Los negocios asignados y el
rol **NO van en el token**: se cargan en cada request con una query indexada a
`UsuarioNegocio` (es barata, y si hace falta se cachea en memoria unos
segundos por instancia).

*Trade-off:* meter `{negocios: [...], roles: {...}}` en el token ahorra esa
query, pero el token queda viejo cuando le sacás un negocio a alguien o lo
desactivás — y "le saqué el acceso pero sigue viendo todo hasta que expire la
cookie" es exactamente el bug que no querés en un CRM multi-cliente. Con el
token mínimo, desactivar un usuario o quitarle un negocio tiene efecto en el
próximo request.

**Middleware único de autorización.** Un solo helper por el que pasa TODA ruta
del backoffice:

```js
// contexto(req) → { usuario, negocios: Map<negocioId, rol> }  o  401
// exigirNegocio(ctx, negocioId, rolMinimo?) → 403 si no está en el Map
```

Y la regla de oro para las queries: **ninguna función de `db.js` acepta ser
llamada sin `negocioId`** (o sin la lista `negocioIds` para la vista "todas").
El `WHERE negocioId IN (...)` no se escribe a mano en cada handler; lo arma el
helper. Un handler que quiera saltearse el filtro tiene que llamar a una
función que no existe.

**Roles:**

| Acción | agente | admin (del negocio) | superAdmin |
|---|---|---|---|
| Ver/atender conversaciones del negocio | ✔ | ✔ | ✔ |
| Reasignar conversaciones de otros | – | ✔ | ✔ |
| Gestionar atajos/etiquetas del negocio | – | ✔ | ✔ |
| Invitar/gestionar usuarios del negocio | – | ✔ (limitado por `maxAgentes` del tier) | ✔ |
| Crear negocios, tiers, API keys, canales | – | – | ✔ |

La UI usa el mismo dato: al loguearse, `GET /api/backoffice/yo` devuelve
`{ usuario, negocios: [{id, clave, nombre, rol, features}] }` y el frontend
muestra el selector de negocio con eso (equivalente al `?n=` de hoy, pero
validado server-side contra `UsuarioNegocio`, no abierto).

---

## 4. Conexión de cada bot con el CRM

**Env vars del bot** (reemplazan a `LOG_TURSO_*` y a toda credencial de base
central): solo dos —

```
CRM_API_URL=https://crm.tuproducto.vercel.app
CRM_API_KEY=wbk_...        # generada por el superAdmin en el CRM, una por negocio
```

**Endpoints de ingesta** (autenticados por `Authorization: Bearer <key>`; el
servidor hace `sha256(key)` → `BotApiKey` → `negocioId`, y a partir de ahí el
bot no puede nombrar a otro negocio ni queriendo):

```
POST /api/ingest/mensaje
  { numero, nombre?, phoneNumberId?, rol, contenido }
  → { estado: 'bot' | 'humano' }
```

Un solo endpoint sincrónico en el hot path: el bot registra el mensaje entrante
y **en la misma respuesta** se entera si la conversación está en modo `humano`
(entonces no contesta). Cuando el propio bot responde, manda otro
`POST /api/ingest/mensaje` con `rol: 'assistant'` — ese puede ser
fire-and-forget. Cuando el clasificador decide derivar:

```
POST /api/ingest/derivar   { numero }   → marca estado='humano'
```

**Las respuestas de agentes salen por el CRM, no por el bot.** El CRM tiene el
token de Graph API de cada canal (`Canal.tokenCifrado`) y manda directo, igual
que hoy hace `bot/lib/whatsapp.js` desde el backoffice single-tenant. Así el
bot queda con una sola responsabilidad (webhook de Meta + LLM) y no hace falta
que exponga ningún endpoint propio ni comparta secretos con el CRM.

**Si el CRM está caído** (single point of failure, ver §6): el bot no puede
saber si la conversación estaba en `humano`. Regla de degradación explícita:
timeout corto (~2s) y el bot **responde igual** (mejor un bot que contesta una
conversación derivada durante un incidente, que todos los clientes mudos), y
loguea el evento para reintentarlo. Si preferís lo contrario para quejas
delicadas, es un if — pero decidilo a propósito, no por omisión.

---

## 5. Tiers y features

`Negocio.tier` + tabla `PlanFeature` (catálogo por plan) + `NegocioFeature`
(overrides puntuales). Un solo helper compartido:

```js
// features(negocioId) → { maxAgentes: 3, etiquetas: true, notas: true, ... }
// resolución: defaults del código ← PlanFeature[tier] ← NegocioFeature
```

- **Backend:** `if (!feats.etiquetas) return res.status(403)...` en el handler
  correspondiente. El chequeo de verdad vive acá.
- **Frontend:** el mismo objeto `features` ya viaja en `/api/backoffice/yo`
  (§3), así que el HTML solo oculta lo que no corresponde — nunca es la única
  barrera.
- Nada de esto nombra un `negocioId` en el código: subir de plan a un cliente
  es `UPDATE Negocio SET tier='pro'`, y una excepción puntual es un INSERT en
  `NegocioFeature`.

*Alternativa considerada:* una columna JSON `features` directamente en
`Negocio`. Más simple (una sola lectura), pero cambiar qué incluye el plan
"pro" obliga a editar el JSON de cada negocio pro; con el catálogo, es un
UPDATE a `PlanFeature`. El catálogo gana apenas tenés más de ~3 clientes.

---

## 6. Riesgos, trade-offs y migración

**a) La base central es un single point of failure.** Hoy, si se cae la base
de un cliente, se cae UN bot; mañana, si se cae `whatsbot-demo-logs`, se
degradan todos. Mitigaciones: la degradación explícita del §4 (los bots siguen
contestando sin CRM), y en Turso, réplicas de lectura si crece. Aceptable para
la escala actual; el punto es tener la regla de fallback escrita.

**b) Blast radius de datos.** Todos los clientes en una base ⇒ un descuido en
una query del CRM puede cruzar tenants. Por eso: (1) API de ingesta que deduce
el tenant de la key, (2) `negocioId` redundante en tablas hijas, (3) helpers de
`db.js` que no permiten queries sin filtro. Si algún día un cliente exige
aislamiento físico (banco, salud), ese cliente puntual puede volver al modelo
base-propia — la arquitectura no lo prohíbe, el CRM simplemente no lo muestra.

**c) Migración de las bases actuales.** Por cada negocio existente, un script
(`scripts/migrar-negocio.mjs <clave-negocio>` con las `TURSO_*` viejas en env):

1. Crear el `Negocio`, sus `Canal` y su `BotApiKey` en la base central.
2. Copiar `Conversacion` (el PK `numero` pasa a `(negocioId, numero)`;
   `canal`→`canalId`), luego `Mensaje` y `Nota` remapeando a `conversacionId`.
3. `Agente` → `Usuario` + fila en `UsuarioNegocio`: si el mismo `usuario`
   existe ya (una persona que atiende dos negocios), NO se duplica — se agrega
   solo la fila puente. Ojo: si dos negocios tenían un `valentina` que son
   personas distintas, hay que renombrar uno ANTES de migrar.
4. `Atajo` → con `negocioId` (dejan de ser globales por-cliente; los que
   quieras compartidos los pasás a `negocioId NULL` a mano).
5. Cambiar las env vars del bot (`CRM_API_URL`/`CRM_API_KEY`), redeploy, y
   recién ahí dar de baja la base vieja. Ventana de corte: minutos, y el orden
   (migrar datos → switchear bot) no pierde mensajes porque la base vieja queda
   congelada de solo-lectura al switchear.

Las tablas `Demo*` de `whatsbot-demo-logs` se migran igual (cada `negocio` TEXT
del demo → un `Negocio`) o se dejan como están si preferís que el demo siga
aparte; no chocan con el esquema nuevo.

**d) Campos custom por negocio a futuro.** No hacer `ALTER TABLE` por cliente:
para eso está `Conversacion.datosExtra` (JSON). SQLite/libSQL tiene `json_extract`
si algún día hace falta filtrar por algo de adentro. Si un campo custom se
vuelve común a varios clientes, ahí sí se promueve a columna real con una
migración normal.

**e) Versionado del schema.** Centralizar ES la mejora: hoy un cambio de schema
implica correr el ALTER en N bases (los bloques "MIGRACIÓN" comentados en tus
schema.sql actuales); mañana es una sola base. Formalizarlo con una tabla
`_migracion (version INTEGER PRIMARY KEY, aplicadaEn TEXT)` y archivos
`migrations/001-*.sql` numerados que un script aplica en orden — diez líneas de
código, y se acabó el "¿a esta base ya le corrí el ALTER?".

**f) Noisy neighbor.** Un negocio con pico de tráfico consume cuota de Turso y
de las funciones del CRM que comparten todos. A esta escala no es problema;
si crece, rate-limit por API key en `/api/ingest` (contador en memoria por
instancia alcanza para empezar).
