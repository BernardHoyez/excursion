/* Excursion Service Worker – optimisé GitHub Pages
 * Stratégie : Network-first pour l'app (évite les caches cassés)
 *             Cache-first uniquement pour les assets statiques versionnés
 *             Network-only pour les tuiles cartographiques
 */

const CACHE_VERSION = 'excursion-v7';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// Assets de l'application (chemins relatifs → compatibles sous-dossier GitHub Pages)
const SHELL_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ---------- Install ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()) // active immédiatement la nouvelle version
  );
});

// ---------- Activate : nettoie les anciens caches ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Requêtes non-GET → réseau uniquement
  if (req.method !== 'GET') {
    return;
  }

  // 2. Tuiles cartographiques (OSM, IGN, etc.) → réseau uniquement (pas de cache)
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('geopf.fr') ||
    url.pathname.includes('/wmts') ||
    url.pathname.includes('/tile')
  ) {
    event.respondWith(fetch(req).catch(() => new Response('', { status: 408 })));
    return;
  }

  // 3. CDN externes (Leaflet, JSZip, togeojson) → network-first + cache runtime
  if (
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // 4. Même origine (app shell) → network-first pour toujours avoir la dernière version
  //    Fallback sur le cache si offline
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // 5. Tout le reste → réseau
  event.respondWith(fetch(req));
});

// ---------- Stratégie Network-First ----------
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);

    // Mettre en cache uniquement les réponses valides de même origine ou CORS ok
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(cacheName);
      // On clone pour pouvoir à la fois répondre et mettre en cache
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Offline → on tente le cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // Dernier recours pour la navigation
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Hors ligne', { status: 503, statusText: 'Offline' });
  }
}

// ---------- Message : forcer la mise à jour ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
