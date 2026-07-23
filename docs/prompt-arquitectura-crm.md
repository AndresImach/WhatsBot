Necesito que diseñes la arquitectura de un sistema multi-cliente para un producto de chatbots de WhatsApp + CRM/backoffice. Te doy el contexto actual y lo que quiero lograr.

## Contexto actual

Hoy el sistema es single-tenant: cada cliente ("negocio") tiene su propio deploy de un bot de WhatsApp en Vercel (Node.js, funciones serverless), con:
- Su propio número de WhatsApp Cloud API (token + phone_number_id de Meta, propios de esa WABA).
- Un LLM (Claude) que responde con un prompt/configuración hardcodeada para ESE negocio.
- Su propia base de datos (Turso/libSQL) con estas tablas: Conversacion (numero, nombre, estado 'bot'|'humano', canal, canalNombre, asignadoA, asignadoNombre, etiquetas, valoracion, updatedAt), Mensaje (numero, rol, contenido, ts), Nota (notas internas por conversación), Agente (usuario, passwordHash, nombre, activo) y Atajo (respuestas rápidas).
- Un backoffice web propio (login de agentes, bandeja de conversaciones, toma de conversaciones derivadas a humano, notas, etiquetas, valoración del bot) que hoy vive en el MISMO deploy que el bot, sirviendo a un solo negocio.

Cuando una conversación requiere intervención humana, el bot deja de responder y un agente humano la atiende desde ese backoffice.

## Lo que quiero construir

Quiero separar la arquitectura en dos piezas:

1. **Bot por negocio**: sigue siendo un deploy independiente por cliente (uno por WABA/número de WhatsApp), porque cada negocio tiene sus propias credenciales de Meta y su propio prompt/lógica de negocio. Esto no cambia.

2. **CRM/backoffice unificado**: UN SOLO deploy que sirve a TODOS los negocios/clientes a la vez, en vez de un backoffice por cliente. Los agentes humanos van a atender conversaciones de distintos negocios desde un mismo panel.

Para que el CRM único funcione, necesito una base de datos central (no una por negocio como hoy) donde:

- Existe una entidad **Negocio** (id, nombre, y un "tier" de plan que determina qué funcionalidades del CRM tiene habilitadas ese negocio — ej. cantidad de agentes, etiquetas avanzadas, etc.).
- Existe una entidad **Usuario** (agentes humanos) que puede estar asignado a UNO O VARIOS negocios a la vez (relación muchos a muchos), y dentro de cada negocio tiene un rol/permiso propio (ej. puede ser admin en el negocio A y solo agente en el negocio B).
- Las conversaciones, mensajes, notas y atajos que hoy vivían en una base por negocio, ahora tienen que quedar asociados a un negocioId, para que el CRM pueda filtrar correctamente qué ve cada usuario según los negocios que tiene asignados.
- Cada deploy de bot (que sigue siendo uno por negocio) tiene que escribir sus conversaciones/mensajes a esta base central, identificando siempre a qué negocioId pertenecen.

## Lo que necesito que me ayudes a diseñar

1. El esquema de base de datos completo para esta arquitectura (tablas, relaciones, índices), incluyendo cómo modelar el multi-tenant (negocioId en cada tabla relevante, tabla puente Usuario↔Negocio con rol/permisos).
2. Cómo debería autenticarse y autorizarse un usuario del CRM: qué va en la sesión/token (negocios asignados + rol por negocio), y cómo debería filtrarse cada query del backend para que un usuario nunca vea datos de un negocio al que no está asignado.
3. Cómo debería conectarse cada deploy de bot (que vive en un proyecto de Vercel separado, con sus propias env vars) a esta base central: qué credenciales/env vars necesita y cómo evita que un bug en un bot pueda escribir/leer datos de otro negocio.
4. Cómo modelar el "tier" de CRM por negocio de forma que sea fácil chequear "¿este negocio tiene habilitada la feature X?" tanto en el backend como en el frontend del backoffice, sin tener que hardcodear negocioId por negocioId en el código (a diferencia de flags ad-hoc por cliente).
5. Cualquier riesgo o trade-off que veas en este diseño (por ejemplo: single point of failure de la base central, cómo migrar los datos que hoy están en las bases separadas por negocio, cómo versionar el schema si en el futuro un negocio necesita campos custom que otros no tienen).

Dame una propuesta concreta de arquitectura (diagramas en texto/ASCII si ayuda), el esquema SQL, y los puntos de decisión donde haya más de una alternativa razonable, explicando el trade-off de cada una.
