// Offline support: the app shell is cached so Kalinga opens and works without
// internet (AI features still need a connection). Bump VERSION on every release.
const VERSION = 'kalinga-v1.0.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'assets/icon.svg', 'css/app.css',
  'js/main.js', 'js/db.js', 'js/auth.js', 'js/forms.js', 'js/render.js', 'js/ui.js', 'js/stats.js', 'js/ai.js',
  'vendor/anthropic.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.anthropic.com') return; // never cache AI traffic
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;
  // Stale-while-revalidate: answer from cache instantly, refresh in the background.
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
