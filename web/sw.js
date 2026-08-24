const CACHE_NAME = 'birdwatch-v2';
const STATIC_ASSETS = [
    '/',
    '/static/style.css',
    '/static/app.js',
    '/static/manifest.json'
];

self.addEventListener('install', event => {
    // Take over immediately on install rather than waiting for all tabs of
    // the old version to close, so a deploy shows up on next reload.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
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
    // Network-first for navigations and same-origin static assets, so a new
    // deploy is picked up on the next load instead of silently serving a
    // stale cached copy; only fall back to cache when offline.
    event.respondWith(
        fetch(event.request)
            .then(response => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});