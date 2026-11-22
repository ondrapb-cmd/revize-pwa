/* Offline provoz: aplikace se uloží do telefonu při prvním otevření.
 * Při nové verzi stačí zvýšit CACHE – stará verze se po načtení nahradí. */
const CACHE = 'revize-pwa-1.2.0';
const FILES = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  // Nejdřív síť (nová verze), bez signálu uložená kopie.
  event.respondWith(fetch(event.request)
    .then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
