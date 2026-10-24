// Service worker: rende il gioco installabile e avviabile anche con rete scarsa.
// Pagina: prima la rete (aggiornamenti immediati), cache solo se offline.
// /assets/: file con hash nel nome, quindi immutabili -> prima la cache.
const CACHE = 'forklift-tycoon-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && (req.mode === 'navigate' || url.pathname.match(/\.(png|svg|webmanifest|glb)$/))) {
        (await caches.open(CACHE)).put(req.mode === 'navigate' ? '/' : req, res.clone());
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req.mode === 'navigate' ? '/' : req);
      if (cached) return cached;
      throw err;
    }
  })());
});
