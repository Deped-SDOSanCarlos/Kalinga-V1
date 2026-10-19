// Offline support for the app shell. Data lives in the central database, so
// files are fetched network-first (always the newest version) and the cache is
// only used when the connection drops. Bump VERSION on every release.
const VERSION = 'kalinga-v2.0.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'assets/icon.svg', 'css/app.css',
  'js/main.js', 'js/config.js', 'js/db.js', 'js/auth.js', 'js/forms.js', 'js/render.js', 'js/ui.js', 'js/stats.js', 'js/ai.js',
  'vendor/anthropic.mjs', 'vendor/supabase.mjs',
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
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return; // never touch database or AI traffic
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
