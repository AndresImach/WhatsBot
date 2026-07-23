# WhatsBot

Todo lo necesario para salir a vender chatbots de WhatsApp. Cinco cosas separadas:

```
landing/   → tu página de venta (la mandás a los clientes)
demo/      → la demo con LLM que mostrás en la reunión
bot/       → el chatbot real que le instalás al cliente que compra
crm/       → el CRM unificado para atender todos los negocios
pedidos/   → PWA de mostrador: el carnicero confirma a mano los pedidos que tomó el bot
```

Cada carpeta se deploya sola a Vercel (proyectos separados). Los bots hablan
con `crm/` por una API key propia del negocio; nunca reciben acceso directo a
la base central.

---

## 1. landing/ — tu página de venta

HTML puro, sin dependencias. Arriba del `index.html` hay un bloque `CONFIG`:
editá tu marca, tu número de WhatsApp, tu ciudad y (si querés) los precios.
Cuando tengas la demo deployada, pegá su URL en `demoUrl`.

**Deploy:** subís la carpeta a Vercel (o Netlify, o GitHub Pages). Es estático, no necesita nada más.

---

## 2. demo/ — la demo con LLM

La misma pantalla de WhatsApp, pero contestando de verdad con Claude.
La API key queda escondida en el servidor (`api/chat.js`), nunca llega al navegador.

**Reskin por cliente:** en `index.html`, el objeto `NEGOCIO` de arriba tiene
nombre, saludo y el `prompt` (el "cerebro" con menú, precios, horarios). Cambiás eso
y ya tenés la demo del rubro que quieras, en 2 minutos.

**Deploy:**
1. Importás la carpeta `demo/` en Vercel.
2. Settings → Environment Variables → `ANTHROPIC_API_KEY = tu-key`.
3. Deploy. Abrís la URL desde el celular en la reunión.

> Nota: el archivo `demo-en-vivo.html` (fuera de esta carpeta) es una versión que
> corre sola dentro de Claude.ai para probar. La que llevás a los clientes es esta.

### Pivot a humano + backoffice (mostrárselo al cliente en la reunión)

La demo simula el mismo "derivar a una persona" que hace el bot real
(`bot/lib/router.js`): un clasificador barato mira cada mensaje y, si es una
queja, un problema de pago/entrega o un pedido explícito de hablar con
alguien, el bot dice su frase de derivación (configurable por negocio en
`negocios.js`, campo `derivacion`) y dejar de contestar esa conversación.

`demo/backoffice.html` es donde el cliente ve esas conversaciones y responde a
mano — el widget del demo (`index.html`) hace polling y muestra la respuesta
como si fuera un mensaje entrante, y con "Devolver al bot" la conversación
vuelve a quedar en piloto automático.

**Un backoffice por negocio:** igual que la demo del chat, el backoffice se
abre para UN negocio con `?n=<clave>` (la misma clave de `negocios.js` que usás
en `/demo?n=<clave>`), y muestra SOLO las conversaciones de ese negocio. Así en
la reunión cada cliente ve su propio backoffice, sin mezclarse con los demás.

- URL por negocio: `https://tu-proyecto.vercel.app/backoffice?n=elfuego`.
- Sin `?n=`: `https://tu-proyecto.vercel.app/backoffice` muestra un selector
  para elegir el negocio (o "Todas las conversaciones", `?todas=1`, para verlas
  todas juntas).
- Necesita: `LOG_TURSO_DATABASE_URL` / `LOG_TURSO_AUTH_TOKEN` (correr
  `demo/schema.sql` una vez ahí) y `BACKOFFICE_SESSION_SECRET`.
- Sin esas env vars, el demo sigue funcionando exactamente igual, solo que sin
  la pausa ni el backoffice (se comporta como antes).

**Login por agente (no hay contraseña única compartida).** Cada persona que
atiende conversaciones tiene su propio usuario:

```bash
cd demo
node scripts/crear-agente.mjs valentina "unaClaveSegura" "Valentina"
```

El mismo comando sirve para resetear la contraseña de un agente que ya existe.
Necesita `LOG_TURSO_DATABASE_URL` / `LOG_TURSO_AUTH_TOKEN` en el entorno (o un
`.env` en `demo/`) — ojo, es la base de LOGS, no la de Tobías.

**Asignación, etiquetas, notas y respuestas rápidas** funcionan igual que en
`bot/` (ver más abajo), con un matiz: acá el "canal" ya lo da el `negocio`
(`sunstar`, `elfuego`, `tobias`, etc.), así que en la vista "Todas las
conversaciones" hay un filtro por negocio en vez de por canal. Las respuestas
rápidas también se pueden scopear por negocio (una clave `horario` puede tener
un texto distinto para el cine que para la rotisería) o dejarse globales.

### CRM de concesionaria

`demo/crm.html` es el backoffice CRM de la agencia de autos ("Usados y
Nuevos Tucumán"). La pestaña **Chats es real**: usa el mismo backend y el
mismo login por agente que `demo/backoffice.html` (conversaciones, responder,
devolver al bot, asignación, etiquetas, notas, valoración y respuestas
rápidas), scopeada al negocio `usadosnuevos` (`?n=<clave>` para apuntarla a
otro). **Equipo** también es real: lista los agentes y gestiona las
respuestas rápidas contra la API. Las demás pestañas (inventario, kanban de
leads, turnos, tomas de usado) siguen siendo maqueta con datos en memoria
— están marcadas "Datos de ejemplo" — hasta que exista backend para eso.
URL: `https://tu-proyecto.vercel.app/crm`. Necesita las mismas env vars que
el backoffice (`LOG_TURSO_*`, `BACKOFFICE_SESSION_SECRET`) y agentes creados
con `scripts/crear-agente.mjs`. Cero dependencias.

---

## 3. crm/ — CRM unificado multi-cliente

Un único backoffice para todos los clientes. Tiene aislamiento por negocio,
usuarios asignables a uno o varios negocios, roles por negocio, canales de
WhatsApp, bandeja unificada, notas, etiquetas, valoración, atajos y un panel
superadmin para provisionar negocios y rotar API keys.

Las tablas viven en la base central `whatsbot-demo-logs`, pero no reemplazan ni
mezclan las tablas `Demo*`: ambos sistemas pueden convivir.

Deploy de producción: <https://whatsbot-crm.vercel.app>

### Preparación local

```bash
cd crm
npm install
cp .env.example .env.local
npm run migrate
npm run bootstrap -- admin "una-clave-de-al-menos-10-caracteres" "Administrador"
npx --yes vercel@latest dev --local --listen 3001
```

Variables obligatorias:

- `CRM_TURSO_DATABASE_URL` / `CRM_TURSO_AUTH_TOKEN`
- `CRM_SESSION_SECRET`
- `CRM_CRYPTO_KEY` (32 bytes en base64)
- `META_GRAPH_VERSION`, tomada de la configuración vigente de la app Meta

El superadmin crea un negocio, registra su Phone Number ID + token permanente y
genera una `wbk_...` que se muestra una sola vez. Esa key y la URL del CRM se
cargan en el deploy del bot.

Los scripts operativos son:

- `npm run backup`: backup lógico en un archivo temporal con permisos privados.
- `npm run migrate:legacy -- --negocio <clave>`: dry-run de una base single-tenant.
- El mismo comando con `--apply`: aplica una importación idempotente y puede
  repetirse después del cambio de deployment para cerrar el delta.

## 4. bot/ — el chatbot que vendés

El sistema real: un webhook conectado al **WhatsApp oficial de Meta** (Cloud API).
Recibe los mensajes de verdad y responde solo.

### Qué tiene adentro

- `api/webhook.js` — recibe los mensajes de Meta y manda la respuesta.
- `lib/router.js` — **router de dos capas** (el guardrail de producción):
  1. Un **clasificador** rápido/barato mira cada mensaje y decide:
     *responder*, *fuera de tema* o *derivar a una persona*.
  2. Solo si es una consulta legítima del negocio, pasa al **modelo principal**.
  Esto evita que el bot conteste cualquier cosa o prometa lo que no debe.
- `lib/config.js` — **lo único que cambiás por cliente**: nombre, prompt del negocio,
  mensajes de "fuera de tema" y "derivación".
- `lib/whatsapp.js` — manda la respuesta por la Graph API.
- `lib/crm.js` — registra mensajes y consulta el estado humano por HTTP.

### Deploy y conexión con Meta

**A. Deploy en Vercel**
1. Importás la carpeta `bot/` en Vercel.
2. Cargás las Environment Variables (ver `.env.example`):
   `ANTHROPIC_API_KEY`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN`,
   `META_GRAPH_VERSION`, `CRM_API_URL` y `CRM_API_KEY`.
   El `VERIFY_TOKEN` es una palabra secreta que inventás vos.
3. Deploy. Tu webhook queda en `https://tu-proyecto.vercel.app/api/webhook`.

**B. WhatsApp Cloud API (developers.facebook.com)**
1. Creás una app de tipo Business y agregás el producto **WhatsApp**.
2. En *API Setup* copiás el **Phone Number ID** y el **token** (arrancá con el temporal).
3. En *Configuration → Webhook*:
   - Callback URL: `https://tu-proyecto.vercel.app/api/webhook`
   - Verify token: el mismo `VERIFY_TOKEN` que pusiste en Vercel.
   - Suscribite al campo **messages**.
4. Con el número de prueba de Meta ya podés mandarle un WhatsApp y ver que responde.

**C. Pasar a producción (cuando el cliente compra)**
- Cargás el número real del negocio en WhatsApp Business Platform.
- Generás un **token permanente** (System User) y lo actualizás en Vercel.
- Verificás el negocio en Meta si hace falta.

> **Costo:** responder dentro de la ventana de 24hs a un mensaje que inició el
> cliente (mensaje de servicio) no tiene costo por conversación. Lo que se paga
> es el uso de la API de Claude por mensaje.

### Historial y atención humana

El bot no tiene credenciales Turso ni backoffice propio. Cada mensaje se
registra en el CRM mediante `CRM_API_URL` + `CRM_API_KEY`, y la respuesta de
ingesta incluye el historial y el estado `bot|humano`.

Si el CRM no responde dentro de aproximadamente dos segundos, el bot reintenta
una vez y sigue atendiendo con el mensaje actual como contexto. Registra un
evento técnico sin contenido ni teléfono completo; no hay una cola durable.
Las respuestas de agentes humanos salen directamente desde el CRM por el canal
de WhatsApp cifrado en la base central.

---

## 5. pedidos/ — PWA de mostrador (confirmar pedidos a mano)

La contraparte **visual** del bot para carnicerías/verdulerías. El bot arma el
pedido con el cliente pero **nunca lo confirma solo**: lo deja `pendiente` y el
carnicero decide desde una tablet en el mostrador qué se cumple y qué no
(confirmar / marcar sin stock / editar cantidad, por ítem). Recién ahí el bot
retoma la conversación.

- Instalable (PWA: `manifest.json` + service worker), pensada para tablet Android
  ~10" y también PC. Botones grandes, alto contraste, polling (sin push).
- Misma base de Turso y mismo estilo que el bot. **Cero dependencias.**
- El bot crea pedidos con `POST /api/pedidos` (Bearer token); el carnicero entra
  con un **PIN**.

Todo el detalle (pantallas, API, deploy, env vars) está en `pedidos/README.md`.

---

## Publicar en GitHub

```bash
cd whatsbot
git init
git add .
git commit -m "Primera versión: landing, demo y bot"
# creás el repo vacío en github.com y después:
git remote add origin https://github.com/TU-USUARIO/whatsbot.git
git branch -M main
git push -u origin main
```

Las API keys **no** se suben: están solo como variables de entorno en Vercel,
y `.env` está ignorado en `.gitignore`.
