// PWA install (service worker) + the version indicator/silent-auto-update pair described in
// CLAUDE.md's PWA section: one version string, stamped into version.json/js/version.js at
// deploy time, serves both as what's shown on the kiosk screen and as the freshness signal that
// triggers a silent reload once the tablet is idle.
import { $ } from '../utils.js';
import { APP_VERSION } from '../version.js';

const POLL_MS = 5 * 60 * 1000; // network fetch, not a local check — 5 min keeps it cheap

const el = $('appVersion');
if (el) el.textContent = APP_VERSION;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline-shell caching is a nice-to-have, not required for the app to function — a
      // failed registration (e.g. first-ever load with no network at all) shouldn't be loud.
    });
  });
}

// "Idle" = nothing the reload could interrupt: no open modal-overlay, and neither punch nor
// payment confirmation overlay is mid-animation. Reuses the existing .open convention already
// in css/styles.css/index.html rather than adding new state.
function isIdle() {
  if (document.querySelector('.modal-overlay.open')) return false;
  if ($('punchConfirm')?.classList.contains('open')) return false;
  if ($('paymentConfirm')?.classList.contains('open')) return false;
  return true;
}

async function checkForUpdate() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    const { version } = await res.json();
    if (version && version !== APP_VERSION && isIdle()) {
      location.reload();
    }
  } catch {
    // No network right now — nothing to do, next poll will try again.
  }
}

setInterval(checkForUpdate, POLL_MS);
