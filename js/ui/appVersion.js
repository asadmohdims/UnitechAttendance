// PWA install (service worker) + the version indicator/silent-auto-update pair described in
// CLAUDE.md's PWA section: one version string, stamped into version.json/js/version.js/sw.js at
// deploy time, serves both as what's shown on the kiosk screen and as the freshness signal that
// triggers a silent reload once the tablet is idle.
import { $ } from '../utils.js';
import { APP_VERSION } from '../version.js';

const POLL_MS = 5 * 60 * 1000; // network fetch, not a local check — 5 min keeps it cheap
const IDLE_RETRY_MS = 5000;

const el = $('appVersion');
if (el) el.textContent = APP_VERSION;

// "Idle" = nothing the reload could interrupt: no open modal-overlay, and neither punch nor
// payment confirmation overlay is mid-animation. Reuses the existing .open convention already
// in css/styles.css/index.html rather than adding new state.
function isIdle() {
  if (document.querySelector('.modal-overlay.open')) return false;
  if ($('punchConfirm')?.classList.contains('open')) return false;
  if ($('paymentConfirm')?.classList.contains('open')) return false;
  return true;
}

function reloadWhenIdle() {
  if (isIdle()) location.reload();
  else setTimeout(reloadWhenIdle, IDLE_RETRY_MS);
}

const sw = navigator.serviceWorker;
// Read before registering: on a first-ever visit there's no worker yet, and the new one taking
// control shouldn't count as "an update arrived".
const hadController = !!sw?.controller;

if (sw) {
  window.addEventListener('load', () => {
    sw.register('./sw.js').catch(() => {
      // Offline-shell caching is a nice-to-have, not required for the app to function — a
      // failed registration (e.g. first-ever load with no network at all) shouldn't be loud.
    });
  });
  // A new deploy's worker has finished pre-caching and taken over (sw.js activates itself
  // straight away). This page is still running the previous deploy's code, so reload into the
  // new version as soon as nothing would be interrupted.
  sw.addEventListener('controllerchange', () => {
    if (hadController) reloadWhenIdle();
  });
}

async function checkForUpdate() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    const { version } = await res.json();
    if (!version || version === APP_VERSION) return;
    if (sw?.controller) {
      // Under the service worker, reloading now would just serve this same old version from
      // the old cache. Have the browser fetch the new sw.js instead. Once it has pre-cached the
      // new version and taken over, 'controllerchange' above does the reload. If that install
      // fails (e.g. Wi-Fi drops mid-download), the tablet stays on the working old version and
      // the next poll tries again, with no reload loop.
      const reg = await sw.getRegistration();
      reg?.update().catch(() => {});
    } else {
      reloadWhenIdle();
    }
  } catch {
    // No network right now — nothing to do, next poll will try again.
  }
}

setInterval(checkForUpdate, POLL_MS);
