// --- Service Worker ---

// --- Configuration ---
// Change this version every time you update any of the cached files.
const CACHE_VERSION = 'v3';
const CACHE_NAME = `task-manager-cache-${CACHE_VERSION}`;

// Files to cache immediately on install.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// --- Event Listeners ---

// INSTALL: Cache the core application shell.
self.addEventListener('install', event => {
  console.log(`[Service Worker] Installing version ${CACHE_VERSION}...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching core assets.');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => self.skipWaiting()) // Force activation of the new service worker
      .catch(error => console.error('[Service Worker] Installation failed:', error))
  );
});

// ACTIVATE: Clean up old caches.
self.addEventListener('activate', event => {
  console.log(`[Service Worker] Activating version ${CACHE_VERSION}...`);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log(`[Service Worker] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[Service Worker] Ready to handle fetches!');
      return self.clients.claim(); // Take control of open clients
    })
  );
});

// FETCH: Serve assets from cache or network.
self.addEventListener('fetch', event => {
  const { request } = event;

  // For navigation requests (e.g., loading the main HTML page),
  // always try the network first to get the latest version.
  // If the network fails, fall back to the cached version.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
    );
    return;
  }

  // For all other requests (like external APIs or scripts),
  // let them pass through to the network directly without caching.
  // This prevents caching of dynamic data from Supabase.
  if (!CORE_ASSETS.includes(new URL(request.url).pathname.substring(1)) && !CORE_ASSETS.includes(new URL(request.url).pathname)) {
      return;
  }
  
  // For core assets, use a "cache-first" strategy.
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      return cachedResponse || fetch(request);
    })
  );
});


// PUSH: Handle incoming push notifications.
self.addEventListener('push', event => {
  if (!(self.Notification && self.Notification.permission === 'granted')) {
    return;
  }

  const data = event.data?.json() ?? {};
  const title = data.title || 'إشعار جديد';
  const options = {
    body: data.body || 'لديك تحديث جديد.',
    icon: './images/icon-192.png',
    badge: './images/icon-192.png',
    vibrate: [100, 50, 100],
    dir: 'rtl',
    lang: 'ar',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// NOTIFICATION CLICK: Handle clicks on notifications.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = new URL('./', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // If a window is already open, focus it.
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        // Otherwise, open a new window.
        return clients.openWindow(urlToOpen);
      })
  );
});
