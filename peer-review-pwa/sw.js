// sw.js — Service Worker: Offline-First App Shell
const CACHE_NAME = 'peerflow-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/main.css',
  './js/app.js',
  './js/repos/idb-client.js',
  './js/repos/repos.js',
  './js/services/services.js',
  './js/sync/sync-service.js',
  './js/ui/views.js',
  './manifest.json'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-first for app shell, Network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API calls: Network-first (skip cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(
        JSON.stringify({ error: 'offline', message: 'Operación guardada para sincronización posterior' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Google Fonts: Network-first with cache fallback
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open('peerflow-fonts').then(cache =>
        fetch(event.request)
          .then(response => { cache.put(event.request, response.clone()); return response; })
          .catch(() => cache.match(event.request))
      )
    );
    return;
  }

  // App shell: Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML navigation
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Background sync (if browser supports it)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-peerflow') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_REQUESTED' }));
      })
    );
  }
});
