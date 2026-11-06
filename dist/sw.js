const CACHE_PREFIX = "octane-iq-";
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const APP_ROOT = new URL("./", self.location.href);
const assetUrl = (path) => new URL(path, APP_ROOT).href;
const CORE_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "spotter.html",
  "spotter.js",
  "spotter.css",
  "credits.html",
  "credits.js",
  "data/cars.json",
  "data/vehicle-catalog.json",
  "data/daily-cars.json",
  "cardle.html",
  "cardle.js",
  "cardle.css",
  "connections.html",
  "connections.js",
  "connections.css",
  "data/connections.json",
  "autoask.html",
  "autoask.js",
  "autoask.css",
  "data/autoask.json",
  "account.html",
  "account.js",
  "account.css",
  "auth-config.js",
  "data/questions.json",
  "manifest.webmanifest",
  "favicon.svg"
].map(assetUrl);
const NAVIGATION_FALLBACK = assetUrl("index.html");
const NETWORK_FIRST_PATHS = new Set(CORE_ASSETS.map((url) => new URL(url).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    const response = await cache.match(assetUrl("data/cars.json"));
    const cars = await response.json();
    // Keep installation light as the photo library grows. Other photos are
    // cached on first view by the fetch handler below.
    await cache.addAll([...new Set(cars.slice(0, 3).map((car) => assetUrl(car.image)))]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;

  const networkFirst = event.request.mode === "navigate" || NETWORK_FIRST_PATHS.has(url.pathname);
  if (networkFirst) {
    event.respondWith(
      fetch(event.request).then(async (response) => {
        if (!response.ok) throw new Error(`Network returned ${response.status}`);
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
        return response;
      }).catch(() => caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || caches.match(NAVIGATION_FALLBACK)))
    );
    return;
  }

  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })));
});
