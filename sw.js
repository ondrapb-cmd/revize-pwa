/* Offline provoz: aplikace se uloží do telefonu při prvním otevření.
 *
 * Soubory aplikace se berou NEJDŘÍV Z TELEFONU (okamžitý start i při slabém signálu ve sklepě,
 * kdy síť „visí“), novou verzi stáhne síť na pozadí. Bez uložené kopie (první spuštění)
 * čeká na síť nejvýš SIT_LIMIT ms. Při nové verzi stačí zvýšit CACHE – nová verze se stáhne
 * celá najednou (mimo mezipaměť prohlížeče) a aplikace ohlásí, že ji stačí zavřít a otevřít.
 */
const CACHE = 'revize-pwa-1.5.0';
const FILES = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
const SIT_LIMIT = 3000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(FILES.map(file => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

function sLimitem(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('síť neodpověděla')), ms))]);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  const navigation = request.mode === 'navigate';
  // Otevření aplikace (i návrat z přihlášení s ?code=…) = vždy stránka aplikace pod jedním klíčem.
  const key = navigation ? './' : request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true }) || (navigation ? await cache.match('./index.html') : undefined);
    const network = fetch(request).then(response => {
      if (response.ok && response.type === 'basic') cache.put(key, response.clone());
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));  // aktualizace na pozadí, start nečeká
      return cached;
    }
    try { return await sLimitem(network, SIT_LIMIT); }
    catch (error) { return (navigation && await cache.match('./index.html')) || Response.error(); }
  })());
});
