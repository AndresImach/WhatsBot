# WhatsBot

Todo lo necesario para salir a vender chatbots de WhatsApp. Tres cosas separadas:

```
landing/   → tu página de venta (la mandás a los clientes)
demo/      → la demo con LLM que mostrás en la reunión
bot/       → el chatbot real que le instalás al cliente que compra
```

Cada carpeta se deploya sola a Vercel (proyectos separados). No dependen entre sí.

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

---

## 3. bot/ — el chatbot que vendés

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

### Deploy y conexión con Meta

**A. Deploy en Vercel**
1. Importás la carpeta `bot/` en Vercel.
2. Cargás las Environment Variables (ver `.env.example`):
   `ANTHROPIC_API_KEY`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN`.
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

### Historial de conversación

Por ahora el historial vive en memoria y se borra si el servidor se reinicia.
Para un negocio con volumen conviene un store persistente (Vercel KV / Upstash Redis).
Está marcado en `api/webhook.js`.

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
