// Service Worker: macht die App offline startklar (nach dem ersten Laden).
// Die ROM und Spielstände liegen nicht hier, sondern in IndexedDB.
const CACHE = 'platin-touch-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/autopilot.js', 'js/store.js', 'js/screen.js', 'js/gestures.js', 'js/audio.js', 'js/audio-worklet.js', 'js/emu-worker.js', 'js/menu-overlay.js',
  'vendor/platin_emu.js', 'vendor/platin_emu.wasm',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Netz zuerst (damit Updates sofort ankommen), sonst aus dem Speicher
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/__rom')) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(req);
        if (net.ok) cache.put(req, net.clone());
        return net;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    })()
  );
});
