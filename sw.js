// Network-first service worker: always fetch fresh, fall back to cache when offline.
// API calls (other origins) are never cached.
const CACHE = 'voicelab-v2';
const SHELL = [
  './', 'index.html', 'check.html', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png',
  'app/main.js', 'app/store.js', 'app/api.js', 'app/recorder.js',
  'lib/metrics.js', 'lib/pitch.js', 'lib/mock.js', 'lib/prompts.js',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
