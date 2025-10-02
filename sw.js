const CACHE_NAME = 'personal-assistant-cache-v2';
// CORE_ASSETS now only contains the essential local files for the app shell.
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './images/icon-192.png',
    './images/icon-512.png'
];

self.addEventListener('install', (event) => {
    console.log('Service Worker: Install event in progress.');
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then((cache) => {
            console.log('Service Worker: Caching core assets.');
            return cache.addAll(CORE_ASSETS);
        })
        .then(() => self.skipWaiting())
        .catch(error => console.error('Service Worker: Installation failed:', error))
    );
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activate event in progress.');
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log(`Service Worker: Deleting old cache: ${key}`);
                        return caches.delete(key);
                    })
            );
        }).then(() => {
            console.log('Service Worker: Now ready to handle fetches!');
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Don't cache Supabase API calls or any other external resources.
    // Let them go to the network directly.
    if (url.origin !== self.location.origin || url.pathname.includes('supabase.co')) {
        return;
    }

    // For local assets (HTML, manifest, etc.), use a cache-first strategy.
    event.respondWith(
      caches.match(req).then(cachedResponse => {
        return cachedResponse || fetch(req).then(networkResponse => {
          // Optionally, cache the new response for next time.
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(req, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
});


self.addEventListener('push', function(event) {
  if (!(self.Notification && self.Notification.permission === 'granted')) {
    return;
  }

  const data = event.data?.json() ?? {};
  // The OS/Browser shows the app name. We will use the notification body
  // as the main title to avoid repetition from the app's side.
  const title = data.body || 'لديك رسالة جديدة.'; 
  const icon = './images/icon-192.png'; 

  const options = {
    // The body is now empty, as the main content is in the title.
    icon: icon,
    badge: './images/icon-192.png',
    vibrate: [100, 50, 100],
    dir: 'rtl', // Set direction to Right-to-Left
    lang: 'ar',   // Set language to Arabic
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const urlToOpen = new URL('./', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then(clientList => {
      // If a window is already open, focus it and navigate.
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window.
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
