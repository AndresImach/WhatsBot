# pedidos/ — PWA de gestión de pedidos (mostrador)

La contraparte **visual** del bot para carnicerías / verdulerías. El bot arma el
pedido con el cliente por WhatsApp pero **nunca lo confirma solo**: lo deja en
estado `pendiente` y un humano (el carnicero) decide desde esta app qué se
cumple y qué no. Recién ahí el bot retoma la conversación.

Pensada para una **tablet Android en el mostrador** (también anda en PC): botones
grandes, alto contraste, tipografía grande, y las dos pantallas que se usan 20+
veces por día — **Cola** y **Detalle** — a prueba de manos apuradas.

Sin push nativas: se resuelve con **polling** (cada 7s) + sonido + badge.

## Cómo funciona el flujo

```
Bot toma el pedido  ──POST /api/pedidos──▶  estado: pendiente
                                              │
Carnicero lo revisa en la PWA (polling) ◀─────┘
   ✅ confirma / ❌ marca sin stock / ✏️ edita cantidad, por ítem
   └─▶ "Confirmar pedido"  ──PATCH──▶  estado: confirmado_carnicero + timestamp
                                              │
Bot lee el estado y sigue con el cliente ◀────┘
   └─▶ al terminar  ──PATCH {estado:"cerrado"}──▶  estado: cerrado  (Historial)
```

Si el carnicero no responde en 15-20 min, **escala el bot**, no esta PWA: la app
solo refleja el estado real y ordena la cola por más viejo primero (color de
urgencia a los 10 y 15 min).

## Pantallas

1. **Cola** (principal): pedidos pendientes, más viejo primero, con urgencia por
   color, chip "Fuera de horario", badge de conteo, banner + sonido + vibración
   al llegar uno nuevo.
2. **Detalle**: cada ítem en una fila grande con 3 botones táctiles
   (✅ Confirmar / ❌ No hay / ✏️ Editar). "No hay" pide una confirmación extra
   de un toque. Botón grande de **Confirmar pedido** al final (confirmar todo
   tal cual = 2 toques desde la cola).
3. **Catálogo**: alta/baja/edición de productos (nombre, unidad, precio opcional,
   activo/inactivo).
4. **Horario**: grilla de días con apertura/cierre. Define qué pedidos entran
   marcados como "fuera de horario".
5. **Historial**: pedidos ya resueltos (confirmados + cerrados), filtrable por
   fecha, solo lectura.

## API (REST, misma base que el bot)

| Método | Ruta | Quién | Para qué |
|---|---|---|---|
| `POST` | `/api/pedidos` | Bot (Bearer token) | Crear un pedido |
| `GET` | `/api/pedidos?estado=pendiente` | PWA (PIN) | Pollear la cola |
| `GET` | `/api/pedidos/:id` | PWA (PIN) | Detalle |
| `PATCH` | `/api/pedidos/:id` | PWA (PIN) / Bot | Confirmar/editar ítems, cerrar |
| `GET/POST` | `/api/catalogo` · `PATCH/DELETE /api/catalogo/:id` | PWA (PIN) | Catálogo |
| `GET/PUT` | `/api/horario` | PWA (PIN) | Horario semanal |
| `POST` | `/api/auth/login` · `logout` · `GET /api/auth/estado` | PWA | Sesión por PIN |

> Nota: en este monorepo todo cuelga de `/api/` (igual que el backoffice del
> bot), por eso `/api/pedidos` en vez de `/pedidos`.

### Ejemplo — el bot crea un pedido

```bash
curl -X POST https://tu-proyecto.vercel.app/api/pedidos \
  -H "Authorization: Bearer $PEDIDOS_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cliente_nombre": "Juan",
    "cliente_telefono": "5493811234567",
    "items": [
      { "nombre": "Entraña",    "cantidad_pedida": 1,   "unidad": "unidad" },
      { "nombre": "Chinchulín", "cantidad_pedida": 500, "unidad": "g" }
    ]
  }'
```

Si el bot no manda `fuera_de_horario`, lo calcula el backend con el horario
cargado en esta PWA (única fuente de verdad).

## Autenticación (simple, para un carnicero)

- **PWA**: PIN numérico (`PEDIDOS_PIN`) → sesión por cookie firmada con HMAC
  (`PEDIDOS_SESSION_SECRET`), 30 días. Mismo mecanismo que el backoffice del bot.
- **Bot**: `Authorization: Bearer <PEDIDOS_API_TOKEN>` (servidor a servidor).

## Deploy en Vercel

1. Importás la carpeta `pedidos/` como proyecto nuevo.
2. Cargás las Environment Variables (ver `.env.example`):
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PEDIDOS_PIN`,
   `PEDIDOS_SESSION_SECRET`, `PEDIDOS_API_TOKEN` (opcional `NEGOCIO_TZ`).
3. Corré el esquema **una vez** contra tu base de Turso (podés reusar la del bot):

   ```bash
   turso db shell tu-base < pedidos/schema.sql
   ```

4. Deploy. Abrís la URL desde la tablet y **la instalás como app** (Agregar a
   pantalla de inicio / Instalar): tiene `manifest.json` + service worker.

## PWA / offline

- Instalable (manifest + `sw.js`).
- **Offline-first en lectura**: el cascarón y la última cola/catálogo conocidos
  se sirven del cache si se cae el WiFi del local.
- Las **acciones** (confirmar, editar, crear) siempre requieren conexión: nunca
  se cachean ni se encolan escrituras.

## Regenerar los íconos

Los `icon-*.png` se generan sin dependencias:

```bash
node scripts/gen-icons.mjs
```

## Stack

Vanilla JS/HTML + funciones serverless de Vercel + Turso (libSQL) por HTTP.
**Cero dependencias de npm**, igual que el resto del monorepo.
