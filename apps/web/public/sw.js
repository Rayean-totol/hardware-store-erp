/* Service worker for Al Qureshi Hardware ERP Pro. Rules are in sw-rules.js; see docs/pwa-mobile-upgrade.md. */
importScripts('./sw-rules.js');

// Replaced at build time by scripts/stamp-sw.mjs so each build gets a new cache name.
var BUILD_ID = '__BUILD_ID__';
var CACHE = 'erp-static-' + BUILD_ID;
var SCOPE = new URL('./', self.registration.scope).pathname;
var OFFLINE_URL = new URL('./offline.html', self.registration.scope).href;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Each file is optional: a missing icon must not stop the worker from installing.
      return Promise.all(self.swRules.PRECACHE.map(function (path) {
        return cache.add(new URL(path, self.registration.scope).href).catch(function () {});
      }));
    }),
  );
  // No automatic activation: a new version waits until the user chooses to update.
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return name.indexOf('erp-static-') === 0 && name !== CACHE;
      }).map(function (name) { return caches.delete(name); }));
    }),
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var kind = self.swRules.classifyRequest({
    method: request.method,
    url: request.url,
    mode: request.mode,
    hasAuthorization: request.headers.has('authorization'),
    origin: self.location.origin,
    scope: SCOPE,
  });
  if (kind === 'static') {
    event.respondWith(cacheFirst(request));
  } else if (kind === 'navigation') {
    event.respondWith(networkThenOfflinePage(request));
  }
  // 'network': no respondWith, so the browser handles the request exactly as without a worker.
});

function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
      });
    });
  });
}

// Pages are never cached (they can be out of date and must reflect the current session).
// When the network is down, the user gets the offline page.
function networkThenOfflinePage(request) {
  return fetch(request).catch(function () {
    return caches.open(CACHE).then(function (cache) {
      return cache.match(OFFLINE_URL).then(function (page) {
        return page || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      });
    });
  });
}
