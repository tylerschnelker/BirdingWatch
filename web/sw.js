const CACHE_NAME = 'birdwatch-v3';
const STATIC_ASSETS = [
    '/',
    '/static/style.css',
    '/static/app.js',
    '/static/manifest.json'
];

// { cache: 'no-store' } is required here, not just optional hardening:
// fetch() with default caching honors the browser's regular HTTP cache, so
// even a "network-first" handler can silently return a stale response
// without ever actually reaching the server. Every fetch the service worker
// makes - at precache time and at runtime - must bypass it explicitly.
async function precache() {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(STATIC_ASSETS.map(async url => {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) await cache.put(url, response);
    }));
}

self.addEventListener('install', event => {
    // Take over immediately on install rather than waiting for all tabs of
    // the old version to close, so a deploy shows up on next reload.
    self.skipWaiting();
    event.waitUntil(precache());
});

self.addEventListener('activate', event => {
    // Delete any caches from a previous CACHE_NAME so a deploy can't keep
    // serving stale app.js/style.css/index.html indefinitely.
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Network-first (bypassing HTTP cache) for everything, so a new deploy
    // is picked up on the next load; only fall back to the service worker's
    // own cache when offline.
    event.respondWith(
        fetch(event.request, { cache: 'no-store' })
            .then(response => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

self.addEventListener('push', event => {
    let payload = { title: 'BirdWatch', body: 'New bird activity detected.', url: '/' };
    if (event.data) {
        try { payload = event.data.json(); } catch (e) { /* keep default */ }
    }

    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: '/static/icons/icon-192.png',
            badge: '/static/icons/icon-192.png',
            data: { url: payload.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            return clients.openWindow(targetUrl);
        })
    );
});
