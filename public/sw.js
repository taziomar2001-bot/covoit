// Minimal service worker: enables "Add to Home Screen" and offline app shell.
const CACHE = 'covoit-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Network-first for navigations (always fresh app), cache fallback when offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { caches.open(CACHE).then(c => c.put('/', r.clone())); return r; })
      .catch(() => caches.match('/')));
    return;
  }
  // static assets: cache-first
  if (new URL(req.url).origin === location.origin) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
      caches.open(CACHE).then(cache => cache.put(req, r.clone())); return r;
    })));
  }
});
