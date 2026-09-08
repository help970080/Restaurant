/* ComandaPro service worker
   Estrategia: la API, el menú QR y el seguimiento del cliente SIEMPRE van a la
   red. El shell usa network-first con un límite de espera: si la red tarda más
   de 3 s (Render dormido, moto sin señal), sirve lo cacheado y no deja la
   pantalla colgada. Sube CACHE cuando quieras forzar limpieza. */
const CACHE = 'comandapro-shell-v2';
const ESPERA_RED = 3000;
const SHELL = [
  '/', '/index.html',
  '/manifest.webmanifest',
  '/favicon.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
];

// Nunca se cachean: datos vivos o pantallas de cliente que deben ser exactas.
function siempreRed(url) {
  return url.pathname.startsWith('/api/')   // datos de la operación
      || url.pathname.startsWith('/qr/')    // menú y pedido del cliente
      || url.pathname.startsWith('/t/')     // seguimiento del pedido en vivo
      || url.pathname === '/health';
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))) // que un archivo faltante no aborte todo
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Permite que la página pida activar de inmediato una versión nueva.
self.addEventListener('message', (e) => {
  if (e.data === 'actualizar') self.skipWaiting();
});

function conLimite(promesa, ms) {
  return new Promise((ok, err) => {
    const t = setTimeout(() => err(new Error('red lenta')), ms);
    promesa.then((r) => { clearTimeout(t); ok(r); }, (e2) => { clearTimeout(t); err(e2); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                        // nunca tocar mutaciones
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // recursos externos: a la red
  if (siempreRed(url)) return;

  e.respondWith((async () => {
    try {
      const r = await conLimite(fetch(req), ESPERA_RED);
      // Solo se guarda lo que sirvió; un 404 o un error no debe quedar cacheado.
      if (r && r.ok && r.type === 'basic') {
        const cp = r.clone();
        caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {});
      }
      return r;
    } catch (err) {
      const m = await caches.match(req);
      if (m) return m;
      // El index solo sirve de respaldo para una navegación; devolverlo en
      // lugar de un icono o un JSON solo genera errores raros.
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
