// Service worker mínimo: la PWA funciona offline para LEER (el cascarón y la
// última cola/catálogo conocidos), pero cualquier acción (confirmar, editar,
// crear) necesita conexión — nunca cacheamos ni encolamos POST/PATCH/PUT/DELETE.

const CACHE = "pedidos-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Solo manejamos nuestro propio origen.
  if (url.origin !== self.location.origin) return;

  // Mutaciones y llamadas de escritura: siempre a la red, sin tocar el cache.
  if (req.method !== "GET") return;

  const esApi = url.pathname.startsWith("/api/");

  if (esApi) {
    // Lecturas de la API (cola, catálogo, horario): red primero, cache de respaldo
    // para poder mostrar lo último conocido si se cae el WiFi del local.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } })))
    );
    return;
  }

  // Navegación / cascarón: cache primero, con la red como respaldo (offline-first).
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (req.mode === "navigate" || SHELL.includes(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match("/index.html")))
  );
});
