// Simple service worker for offline support
const CACHE_NAME = 'ship-cache-v1';
const APP_SHELL = [
  '/',
  '/docs',
  '/issues',
  '/programs',
  '/team',
  '/settings',
  '/login',
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      // Don't wait for all to succeed - just try to cache
      return Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => console.log(`[SW] Failed to cache ${url}:`, err))
        )
      );
    })
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Skip API requests - let them fail when offline
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/collaboration')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone response for caching
        const responseToCache = response.clone();

        // Cache successful HTML/JS/CSS responses
        if (response.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }

        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request).then((response) => {
          if (response) {
            console.log('[SW] Serving from cache:', event.request.url);
            return response;
          }

          // For navigation requests, return the cached index page
          if (event.request.mode === 'navigate') {
            return caches.match('/').then((indexResponse) => {
              if (indexResponse) {
                console.log('[SW] Serving index for navigation:', event.request.url);
                return indexResponse;
              }
              // No cache available
              return new Response('Offline - no cached content available', {
                status: 503,
                headers: { 'Content-Type': 'text/html' },
              });
            });
          }

          // No cache for this request
          console.log('[SW] No cache for:', event.request.url);
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
