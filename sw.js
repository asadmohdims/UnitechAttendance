// Hand-rolled service worker — no Workbox/npm, consistent with the project's zero-dependency,
// no-build-step constraint (see CLAUDE.md). Its only job is app-shell resilience: same-origin
// files (index.html/css/js) get cached as they're fetched, so the kiosk still loads if Wi-Fi
// drops for a moment. It never touches Supabase (cross-origin) or CDN library requests — those
// pass straight through untouched.
const CACHE_PREFIX = 'unitech-shell-';

// The cache name is keyed by the deploy's version (stamped into version.json by
// .github/workflows/deploy.yml) so activate() can clean out a stale cache from the previous
// deploy — plain cache-versioning, the standard pattern for a hand-rolled SW.
const cacheNamePromise = fetch('./version.json', { cache: 'no-store' })
  .then((r) => r.json())
  .then((j) => CACHE_PREFIX + j.version)
  .catch(() => CACHE_PREFIX + 'dev');

self.addEventListener('install', (event) => {
  // Take over immediately instead of waiting for every tab to close — this kiosk tablet's tab
  // never closes on its own, so the default "wait" behavior would mean updates never land.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keep = await cacheNamePromise;
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== keep).map((k) => caches.delete(k))
    );
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept Supabase writes or anything else non-GET

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase + CDN scripts: untouched
  if (url.pathname.endsWith('/version.json')) return; // the freshness signal must always be live

  event.respondWith((async () => {
    const cache = await caches.open(await cacheNamePromise);
    const cached = await cache.match(req);
    const networkFetch = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      // Stale-while-revalidate: serve instantly from cache, refresh it in the background for
      // next time — don't await the network here.
      return cached;
    }
    return (await networkFetch) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
