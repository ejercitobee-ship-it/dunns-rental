// MH Dunn Property service worker. Deliberately conservative so a frequently
// deployed app never serves a stale screen:
//   - Page loads (navigations): network first, so people always get the current
//     app; the last page seen is kept only as an offline fallback.
//   - Build assets (/assets/*): cache first, since their filenames are hashed
//     and never change.
//   - API and cross-origin requests: never touched.
const CACHE = 'mhdunn-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone
  if (url.pathname.startsWith('/api/')) return; // never cache the API

  // Immutable, hashed build assets: serve from cache, fall back to network.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // Page navigations: network first (fresh app), keep a copy for offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/offline-shell', res.clone());
        return res;
      } catch {
        return (await caches.match('/offline-shell')) || Response.error();
      }
    })());
  }
});
