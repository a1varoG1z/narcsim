const CACHE_NAME = "narcosim-cache-v4";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/dataLoader.js",
  "./js/events.js",
  "./js/main.js",
  "./js/model.js",
  "./js/npcGenerator.js",
  "./js/scriptedEvents.js",
  "./js/state.js",
  "./js/turnEngine.js",
  "./js/screens/characterCreate.js",
  "./js/screens/characterSelect.js",
  "./js/screens/dashboard.js",
  "./js/screens/eraSelect.js",
  "./js/screens/mainMenu.js",
  "./js/screens/tabs/characterProfile.js",
  "./js/screens/tabs/decisionsView.js",
  "./js/screens/tabs/editorView.js",
  "./js/screens/tabs/familyView.js",
  "./js/screens/tabs/mapView.js",
  "./js/screens/tabs/mediaView.js",
  "./js/screens/tabs/orgChart.js",
  "./js/screens/tabs/overview.js",
  "./js/screens/tabs/statsView.js",
  "./js/screens/tabs/warsView.js",
  "./js/ui/components.js",
  "./js/ui/modal.js",
  "./js/utils/random.js",
  "./js/utils/storage.js",
  "./js/utils/text.js",
  "./data/eras/index.json",
  "./data/eras/cjng-sinaloa-2015-actualidad.json",
  "./data/eras/fragmentacion-2006-2015.json",
  "./data/eras/guadalajara-1975-1989.json",
  "./data/eras/medellin-cali-1980-1995.json",
  "./data/eras/mexico-rutas-1990-2006.json",
  "./data/eras/chapitos-mayiza-2024-actualidad.json",
  "./data/eras/narcotrafico-gallego-1975-1995.json",
  "./data/eras/ley-seca-1925-1933.json",
  "./data/geo/shapes.json",
  "./js/geoShapes.js",
  "./assets/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first, falling back to cache only when offline. The previous stale-while-revalidate
// strategy served whatever was cached instantly and only refreshed the cache in the background
// for the *next* load — for a single-page app that a player can keep open/reopen across many
// real days, and a game that ships data changes constantly, that meant returning players kept
// seeing outdated map/era data indefinitely unless the cache name itself was bumped (multiple
// real user reports traced back to exactly this: an old map layout persisting for many sessions
// after the underlying data had already changed). Trading a little offline snappiness for
// players always getting current content when they actually have a connection.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
