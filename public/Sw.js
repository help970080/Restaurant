/* ComandaPro service worker — cachea el "shell" de la app para que abra sin internet.
   Estrategia: la API y el QR SIEMPRE van a la red (nunca se cachean). El shell usa
   network-first: si hay conexión trae lo último (y lo guarda); si no, sirve lo cacheado.
   Sube la versión del cache cuando quieras forzar limpieza. */
const CACHE = 'comandapro-shell-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // nunca interceptar mutaciones (POST/PATCH/DELETE)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // recursos externos: a la red
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/qr/')) return; // datos: siempre red
  e.respondWith(
    fetch(req).then((r) => {
      const cp = r.clone();
      caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {});
      return r;
    }).catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
  );
});
