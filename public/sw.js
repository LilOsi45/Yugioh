/*
 * Offline support, hand-written: the whole point of this app is being usable in a
 * shop or at a tournament, which is exactly where the phone signal is worst.
 *
 * Two caching rules, because the two kinds of file want opposite things:
 *
 *   - the app itself (HTML, JS, CSS) is small and versioned by filename, so it is
 *     cached on install and served from cache;
 *   - the card data is 1.3 MB and changes weekly, so it is served from cache
 *     immediately and refreshed in the background — the user never waits for it, and
 *     the next start has the newer data.
 *
 * Deliberately no build plugin: the project has no UI or build dependencies, and a
 * service worker this small is easier to read than to configure.
 */

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;

/** Everything needed to start with no network at all. */
const SHELL_URLS = ['.', 'index.html', 'manifest.webmanifest', 'icon.svg'];

/**
 * The script and stylesheet carry a content hash in their names, so they cannot be
 * listed here. Reading them out of index.html keeps this file free of build magic —
 * and it has to happen at install time: a worker only starts intercepting requests
 * *after* the page that registered it has already loaded, so the very first visit
 * would otherwise cache nothing and the app would be broken the first time it is
 * opened without signal. That is precisely the trip to the card shop this is for.
 */
async function assetUrls() {
  try {
    const response = await fetch('index.html', { cache: 'reload' });
    const html = await response.text();
    return [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // allSettled: one missing file must not fail the whole install, or the app
      // never becomes offline-capable at all.
      await Promise.allSettled([...SHELL_URLS, ...(await assetUrls())].map((url) => cache.add(url)));
      // The card data is the big one, and useless to have half of. Fetched here so
      // the first visit is enough, failure ignored — the page fetches it anyway.
      const data = await caches.open(DATA);
      await data.add('data/db.json').catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL && key !== DATA).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/*
 * `ignoreVary` throughout: responses precached at install were fetched by the worker
 * itself, without the Origin header a page request carries. A server that sends
 * `Vary: Origin` then makes those entries unmatchable, and the app comes up blank
 * offline with everything sitting in the cache unused — measured, not theoretical.
 */
const MATCH = { ignoreVary: true };

/** Cache first, refresh in the background — for data that may be a week old safely. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, MATCH);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch other origins: the card images and the text engine come from
  // elsewhere and have their own caching.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/data/db.json')) {
    event.respondWith(staleWhileRevalidate(request, DATA));
    return;
  }

  // A navigation with no network still has to land somewhere: the app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(
          async () =>
            (await caches.match(request, MATCH)) ??
            (await caches.match('index.html', MATCH)) ??
            Response.error(),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request, MATCH).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
