// Hand-rolled service worker — no Workbox/npm, consistent with the project's zero-dependency,
// no-build-step constraint (see CLAUDE.md). Its job is letting the kiosk boot with no network:
// every file the app needs is downloaded into a cache when this worker installs, and every
// same-origin request is answered from that cache without waiting on the network.
// Supabase (data, photos) is cross-origin and never touched here.

// Stamped by .github/workflows/deploy.yml at deploy time; 'dev' in the repo. It lives in this
// file on purpose. An earlier version fetched version.json at the top of this script instead,
// which made the kiosk wait on Wi-Fi to show the page: Chrome stops an idle worker after ~30s and
// re-runs this whole script on the next request, so a top-level network call runs on nearly
// every page load and every response waited behind it (and offline it fell back to a cache name
// that didn't exist). A version inside this file also means each deploy changes the file's
// bytes, which is what makes the browser install the new worker at all.
const VERSION = 'dev';
const CACHE_PREFIX = 'unitech-shell-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

// Everything the app needs to boot and run offline. js/swPrecache.test.mjs fails if a module
// under js/, or a file index.html/styles.css references, is missing from this list.
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './css/styles.css',
  './vendor/supabase-js-2.117.0.js',
  './assets/fonts/bebas-neue-latin.woff2',
  './assets/fonts/bebas-neue-latin-ext.woff2',
  './assets/icons/icon-32.png',
  './assets/icons/icon-192.png',
  './js/avatars.js',
  './js/camera.js',
  './js/config.js',
  './js/main.js',
  './js/missedClockIn.js',
  './js/paymentsMath.js',
  './js/pin.js',
  './js/reportMath.js',
  './js/rounding.js',
  './js/salary.js',
  './js/staleSession.js',
  './js/state.js',
  './js/supabaseClient.js',
  './js/utils.js',
  './js/version.js',
  './js/store/demoStore.js',
  './js/store/index.js',
  './js/store/outbox.js',
  './js/store/supabaseStore.js',
  './js/ui/appVersion.js',
  './js/ui/employees.js',
  './js/ui/kiosk.js',
  './js/ui/modal.js',
  './js/ui/payments.js',
  './js/ui/records.js',
  './js/ui/report.js',
  './js/ui/salary.js',
  './js/ui/shell.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache:'reload' skips the browser's HTTP cache. GitHub Pages serves every file with a
    // 10-minute max-age, so without it a worker installing right after a deploy could store the
    // PREVIOUS deploy's files under this version's name. addAll() is all-or-nothing: if the
    // network drops mid-install, this install fails, the previous worker keeps serving the
    // previous version from its own complete cache, and the browser retries later.
    await cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })));
    // Take over immediately instead of waiting for every tab to close — this kiosk tablet's tab
    // never closes on its own, so the default "wait" behavior would mean updates never land.
    // js/ui/appVersion.js reloads the page onto the new version once the tablet is idle.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase: network only, never cached here
  if (url.pathname.endsWith('/version.json')) return; // the freshness signal must always be live

  event.respondWith(VERSION === 'dev' ? networkFirst(req) : cacheFirst(req));
});

// Single-page app: every navigation (the start URL, a reload, a ?query variant) is index.html.
function cacheKeyFor(req) {
  return req.mode === 'navigate' ? './index.html' : req;
}

// Every file in a version's cache is that version's only copy, so request headers (GitHub Pages
// sends `Vary: Accept-Encoding`) must never turn a stored file into a miss while offline.
const MATCH_OPTIONS = { ignoreVary: true };

async function fromNetwork(cache, req) {
  const res = await fetch(req);
  if (res.ok) cache.put(cacheKeyFor(req), res.clone());
  return res;
}

const offlineResponse = () => new Response('Offline', { status: 503, statusText: 'Offline' });

// Deployed versions: a cache is exactly one deploy's files, so there's nothing to revalidate.
// A new deploy arrives as a new worker with a new cache, not as edits to this one. That also
// rules out mixing old and new modules on one page. Files outside APP_SHELL (e.g. the Excel
// exporter) are cached the first time they're fetched.
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKeyFor(req), MATCH_OPTIONS);
  if (cached) return cached;
  return fromNetwork(cache, req).catch(offlineResponse);
}

// Local dev only: 'dev' never changes between edits, so cache-first would keep serving stale
// files forever. Use the network when it's there and fall back to the cache when it isn't.
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    return await fromNetwork(cache, req);
  } catch {
    return (await cache.match(cacheKeyFor(req), MATCH_OPTIONS)) || offlineResponse();
  }
}
