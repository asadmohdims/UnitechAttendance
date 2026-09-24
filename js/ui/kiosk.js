import { $, busy, toast, fmtTime, fmtHours, dateStr, hapticSuccess } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { captureFor } from '../camera.js';
import { shouldAutoCloseStaleSession, endOfDayFor } from '../staleSession.js';
import { isMissedClockIn } from '../missedClockIn.js';
import { latestPunchByEmployee, punchLockedUntil } from '../punchCooldown.js';
import { PUNCH_COOLDOWN_MINUTES } from '../config.js';
import { renderPaymentsGrid, togglePaymentsMode } from './payments.js';

$('btnPayments').onclick = togglePaymentsMode;

// The one side-panel button always invites the OTHER screen — "Payments" while looking at
// Attendance, "Attendance" while looking at Payments — so there's always a visible way back
// without tapping the same label twice to toggle blind.
const MODE_BTN_HTML = {
  attendance: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="3"></circle><line x1="6" y1="10" x2="6" y2="10.01"></line><line x1="18" y1="14" x2="18" y2="14.01"></line></svg>Payments',
  payments: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline></svg>Attendance'
};

// Reloads employees + open sessions from the store into shared state and re-renders the kiosk.
// Called after every mutation (add/rename/deactivate employee, punch in/out) so both store
// backends behave identically, instead of demo mode mutating in-memory state directly.
export async function refreshAll(){
  busy(true);
  try{
    // These three reads don't depend on each other's results, so running them together means
    // a cold boot only ever waits as long as the slowest one (capped by supabaseStore.js's own
    // short network timeout when offline) instead of all three back to back — this used to be
    // the difference between the kiosk becoming usable in ~3s vs ~9s on an offline cold start.
    const [employees, openSessions, todaysRecords] = await Promise.all([
      store.listEmployees(),
      store.listOpenSessions(),
      store.listRecordsForDate(dateStr())
    ]);
    state.employees = employees;
    state.openSessions = openSessions;
    applyTodaysRecords(todaysRecords);
    await checkStaleSessionAutoClose();
    renderHome();
  }catch(err){ toast('Load failed: ' + err.message); }
  busy(false);
}

// Rebuilds today's per-employee flags from an already-fetched list: "has any record at all"
// (the source for the missed-clock-in flag, see tileStatus() below) and the latest punch time
// (the source for the duplicate-punch window, see punchTap()).
function applyTodaysRecords(todays){
  state.punchedToday = {};
  todays.forEach(r => { state.punchedToday[r.emp_id] = true; });
  state.lastPunchAt = latestPunchByEmployee(todays);
}

// Safety net for someone who forgets to clock out at all: a punch left open overnight would
// otherwise sit "currently clocked in" forever, forcing the employee's next tap to read as a
// bizarre clock-OUT instead of a fresh start. Closed at midnight, not a guessed real time (see
// js/staleSession.js) — no photo, so it lands in the owner's "needs review" list, not silently
// in someone's pay. Opportunistic, not a server-side job: runs on load and every periodicCheck()
// tick, and BEFORE renderHome(), so by the time the kiosk actually draws tiles a stale session is
// already gone from state.openSessions — the next morning's tap is a normal "tap to start",
// never blocked or confused by the review flag (that only ever shows up on the admin's
// Report/Records screens, never on the kiosk).
//
// This is deliberately the ONLY automatic clock-out. Lunch is never inferred: a fixed cutoff
// can't tell "leaving for lunch at 1:05" from "back from a 5-minute break", and guessing wrong
// silently inverted the meaning of every tap after it (see Lunch-break support in CLAUDE.md).
async function checkStaleSessionAutoClose(){
  const now = new Date();
  const toClose = Object.values(state.openSessions).filter(r => shouldAutoCloseStaleSession(r, now));
  if(!toClose.length) return false;
  for(const rec of toClose){
    try{
      await store.clockOut(rec, null, endOfDayFor(rec).toISOString());
      delete state.openSessions[rec.emp_id];
    }catch(err){
      // Don't let one bad record (e.g. genuinely deleted from the admin panel in the meantime)
      // block the rest of this tick or the next periodicCheck() — this is a silent background
      // safety net nobody's watching, so leave it in openSessions and retry on the next tick
      // rather than surfacing a toast on every failed attempt.
      console.error('Stale-session auto-close failed for record', rec.id, err);
    }
  }
  return true;
}

// A tile's in/missed status, purely from current state — shared by the full rebuild below, the
// lightweight periodic refresh, and Daily records' missed-clock-in banner, so all three can
// never disagree on the rule. No "on lunch" distinction: a second tap of the day is just a
// normal clock-in, same tile as a first-ever tap — the shop runs a plain four-taps-a-day
// pattern (in, out, in, out), and the actual lunch-gap accounting (js/reportMath.js) works
// entirely from the resulting session pairs, not from anything the kiosk highlights.
export function tileStatus(e){
  const open = state.openSessions[e.id];
  const missed = !open && isMissedClockIn(state.punchedToday[e.id]);
  return {open, missed};
}

function renderRoster(active){
  const roster = $('kioskRoster');
  const inCount = active.filter(e => state.openSessions[e.id]).length;
  const missedCount = active.filter(e => tileStatus(e).missed).length;
  roster.style.display = active.length ? '' : 'none';
  roster.innerHTML = active.length
    ? `<span class="dot"></span>${inCount} of ${active.length} clocked in now${missedCount ? ` · ${missedCount} ${missedCount > 1 ? "haven't" : "hasn't"} shown up` : ''}`
    : '';
}

// Full rebuild — employee list, avatars and all. Only call this when the underlying data
// actually changed (refreshAll, a punch): rebuilding re-fetches every avatar via applyAvatar(),
// which for a real captured photo hits Supabase Storage for a fresh signed URL — fine on a
// genuine data load, wasteful (and visibly flickery) if done on a timer. See refreshTileStates()
// for the time-only path used by periodicCheck().
export function renderHome(){
  $('btnPayments').innerHTML = MODE_BTN_HTML[state.kioskMode];
  $('paymentsBanner').style.display = state.kioskMode === 'payments' ? '' : 'none';
  if(state.kioskMode === 'payments'){ renderPaymentsGrid(); return; }

  const grid = $('empGrid');
  grid.innerHTML = '';
  const active = state.employees.filter(e => e.active);
  $('homeEmpty').style.display = active.length ? 'none' : '';
  renderRoster(active);

  active.forEach(e => {
    const {open, missed} = tileStatus(e);
    const div = document.createElement('div');
    div.dataset.empId = e.id;
    div.className = 'badge-tile' + (open ? ' in' : missed ? ' missed' : '');
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.innerHTML = '<span class="state-badge"></span><img class="avatar" alt=""><div class="name"></div><div class="status"></div>';
    const avatar = div.querySelector('.avatar');
    applyAvatar(avatar, e);
    avatar.alt = e.name;
    div.querySelector('.state-badge').textContent = open ? '■' : missed ? '!' : '▶';
    div.querySelector('.name').textContent = e.name;
    div.querySelector('.status').innerHTML = open
      ? `Working since ${fmtTime(open.clock_in)}<br>Tap to finish`
      : missed ? "Hasn't clocked in yet" : 'Tap to start work';
    div.onclick = () => punchTap(e);
    div.onkeydown = ev => { if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); punchTap(e); } };
    grid.appendChild(div);
  });
}

// Time-only refresh for periodicCheck(): updates each existing tile's class/badge/status text
// (the missed-clock-in flag can flip purely from time passing the cutoff, with no data change
// to react to) without touching .avatar — so it never re-fetches a photo URL. Silently no-ops
// on a tile that isn't in the DOM yet (e.g. the very first tick, before refreshAll's initial
// renderHome() has run).
function refreshTileStates(){
  // Payments-mode tiles have no clock-state badge to refresh — this whole function's job (the
  // 5s live in/lunch/missed tick) doesn't apply outside Attendance mode.
  if(state.kioskMode !== 'attendance') return;
  const active = state.employees.filter(e => e.active);
  renderRoster(active);
  active.forEach(e => {
    const tile = $('empGrid').querySelector(`[data-emp-id="${e.id}"]`);
    if(!tile) return;
    const {open, missed} = tileStatus(e);
    tile.className = 'badge-tile' + (open ? ' in' : missed ? ' missed' : '');
    tile.querySelector('.state-badge').textContent = open ? '■' : missed ? '!' : '▶';
    tile.querySelector('.status').innerHTML = open
      ? `Working since ${fmtTime(open.clock_in)}<br>Tap to finish`
      : missed ? "Hasn't clocked in yet" : 'Tap to start work';
  });
}

// Checked on the tile tap, before the camera opens: a repeat tap inside the duplicate-punch
// window never gets as far as a photo, so there's nothing to capture and nothing to undo.
function punchTap(emp){
  if(punchLockedUntil(state.lastPunchAt[emp.id], PUNCH_COOLDOWN_MINUTES)){
    showAlreadyPunched(emp);
    return;
  }
  captureFor(emp, 'punch', blob => handlePunchCapture(emp, blob));
}

async function handlePunchCapture(emp, blob){
  const open = state.openSessions[emp.id];
  let action;
  if(open){
    try{
      await store.clockOut(open, blob);
    }catch(err){
      await refreshAll(); // tile was showing stale data — resync before surfacing the error
      throw err;
    }
    delete state.openSessions[emp.id];
    state.lastPunchAt[emp.id] = new Date().toISOString();
    action = 'out';
  }else{
    const rec = await store.clockIn(emp.id, blob);
    state.openSessions[emp.id] = rec;
    state.punchedToday[emp.id] = true; // avoid a stale "missed" flash until the next refreshAll
    state.lastPunchAt[emp.id] = rec.clock_in;
    action = 'in';
  }
  renderHome();
  showPunchConfirm(emp, action, blob, open);
}

function showPunchConfirm(emp, action, blob, priorOpen){
  $('pcPhoto').src = URL.createObjectURL(blob);
  openPunchConfirm(emp, action,
    action === 'in' ? 'Clocked IN' : 'Clocked OUT',
    action === 'in'
      ? `Started at ${fmtTime(new Date().toISOString())}`
      : `Worked ${fmtHours((Date.now() - new Date(priorOpen.clock_in))/3600000)} hrs today`);
}

// A repeat tap inside the duplicate-punch window. The employee is really asking "did that
// register?", so answer with the same overlay a real punch gets, restating what's already
// recorded — a silently ignored tap would read as "the kiosk is broken" and invite more taps.
// No photo was taken, so show their profile picture in its place.
function showAlreadyPunched(emp){
  const action = state.openSessions[emp.id] ? 'in' : 'out';
  applyAvatar($('pcPhoto'), emp);
  openPunchConfirm(emp, action,
    action === 'in' ? 'Already clocked IN' : 'Already clocked OUT',
    `At ${fmtTime(state.lastPunchAt[emp.id])} — no need to tap again`);
}

function openPunchConfirm(emp, action, title, detail){
  const el = $('punchConfirm');
  $('pcName').textContent = emp.name;
  $('pcAction').textContent = title;
  el.classList.remove('in', 'out');
  el.classList.add(action);
  $('pcDetail').textContent = detail;
  el.classList.add('open');
  hapticSuccess();
  clearTimeout(openPunchConfirm._t);
  openPunchConfirm._t = setTimeout(() => el.classList.remove('open'), 1800);
}
$('punchConfirm').onclick = () => $('punchConfirm').classList.remove('open');

// Small, mostly-invisible signal for the shop owner — hidden whenever the outbox is
// empty (the common case), so it never distracts an employee tapping tiles.
async function updateSyncIndicator(){
  const {pending, stuck} = await store.getSyncStatus();
  const el = $('syncStatus');
  el.className = 'sync-status' + (pending ? (stuck ? ' stuck' : ' pending') : '');
  el.textContent = pending ? (stuck ? `${pending} punch${pending > 1 ? 'es' : ''} pending — check Wi-Fi` : `Syncing ${pending}…`) : '';
}
// Same 5s cadence covers all of these checks — no separate timer for the stale-session close.
// refreshTileStates() (not renderHome()) runs unconditionally, since the missed-clock-in flag
// can flip purely from time passing the cutoff hour — a full renderHome() rebuild here would
// re-fetch every employee's avatar from the network on every tick (see refreshTileStates()).
async function periodicCheck(){
  await checkStaleSessionAutoClose();
  refreshTileStates();
  await updateSyncIndicator();
}
periodicCheck();
setInterval(periodicCheck, 5000);

// Mobile browsers/PWAs suspend a backgrounded tab's JS and just resume the same in-memory
// state on wake — they don't re-run initAuth(), so state.openSessions can silently go stale
// relative to the server for as long as the tablet sits idle (screen lock, app-switch away and
// back). A plain reload fixes it because that DOES re-run initAuth(); this listener catches the
// far more common "never actually reloaded, just woke up" case. Guarded against overlap so a
// flicker of visibility changes can't pile up concurrent refreshes.
let resyncing = false;
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible' || resyncing) return;
  resyncing = true;
  refreshAll().finally(() => { resyncing = false; });
});
