import { $, busy, toast, fmtTime, fmtHours, dateStr, hapticSuccess } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { captureFor } from '../camera.js';
import { shouldAutoCloseForLunch, cutoffTimeFor } from '../lunch.js';
import { shouldAutoCloseStaleSession, endOfDayFor } from '../staleSession.js';
import { isMissedClockIn } from '../missedClockIn.js';
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
    state.employees = await store.listEmployees();
    state.openSessions = await store.listOpenSessions();
    await refreshPunchedToday();
    await checkLunchAutoClose();
    await checkStaleSessionAutoClose();
    renderHome();
  }catch(err){ toast('Load failed: ' + err.message); }
  busy(false);
}

// Rebuilds today's per-employee record count. `punchedToday` (any record at all) is the
// source for the missed-clock-in flag; `sessionsToday` (how many) is what tileStatus() below
// uses to tell "on a break, expected back" (exactly 1 so far) apart from "already completed
// the whole day" (2 or more) — see the comment on state.sessionsToday in js/state.js.
async function refreshPunchedToday(){
  const todays = await store.listRecordsForDate(dateStr());
  state.punchedToday = {};
  state.sessionsToday = {};
  todays.forEach(r => {
    state.punchedToday[r.emp_id] = true;
    state.sessionsToday[r.emp_id] = (state.sessionsToday[r.emp_id] || 0) + 1;
  });
}

// Safety net for someone who forgets to tap out for lunch entirely: anyone still clocked in
// past the configured cutoff gets closed out at that time client-side, so they don't silently
// stay paid through lunch. Opportunistic, not a server-side job — runs once here on load, and
// again on every periodicCheck() tick below, so it self-heals even if the kiosk was offline or
// reloaded well after the cutoff. Manual out-taps never go through this path.
async function checkLunchAutoClose(){
  const now = new Date();
  const toClose = Object.values(state.openSessions).filter(r => shouldAutoCloseForLunch(r, now));
  if(!toClose.length) return false;
  const atIso = cutoffTimeFor(now).toISOString();
  for(const rec of toClose){
    try{
      await store.clockOut(rec.id, null, atIso);
      delete state.openSessions[rec.emp_id];
      // No separate "on lunch" flag to set here — tileStatus() derives that from
      // sessionsToday, which already counted this record when it was created. Closing it
      // (open -> not open) is the only state change this needs to make.
    }catch(err){
      // Don't let one record's failure (e.g. genuinely deleted from the admin panel in the
      // meantime) stop the rest of this tick's tiles from updating, or block the next tick's
      // periodicCheck() from running at all — this is a silent background safety net, not a
      // foreground action anyone's watching, so leave it in openSessions and retry in 5s
      // rather than surfacing a toast on every failed attempt.
      console.error('Lunch auto-close failed for record', rec.id, err);
    }
  }
  return true;
}

// Safety net for someone who forgets to clock out at all — the complement of the lunch check
// above (that one only ever closes a session that started TODAY, so a punch left open overnight
// would otherwise sit "currently clocked in" forever, forcing the employee's next tap to read as
// a bizarre clock-OUT instead of a fresh start). Closed at midnight, not a guessed real time
// (see js/staleSession.js) — same no-photo signal as lunch auto-close, so it lands in the
// owner's "needs review" list, not silently in someone's pay. Runs in the same places (on load,
// every periodicCheck() tick) and BEFORE renderHome(), so by the time the kiosk actually draws
// tiles a stale session is already gone from state.openSessions — the next morning's tap is a
// normal "tap to start", never blocked or confused by the review flag (that only ever shows up
// on the admin's Report/Records screens, never on the kiosk).
async function checkStaleSessionAutoClose(){
  const now = new Date();
  const toClose = Object.values(state.openSessions).filter(r => shouldAutoCloseStaleSession(r, now));
  if(!toClose.length) return false;
  for(const rec of toClose){
    try{
      await store.clockOut(rec.id, null, endOfDayFor(rec).toISOString());
      delete state.openSessions[rec.emp_id];
    }catch(err){
      // Same reasoning as checkLunchAutoClose's own catch: don't let one bad record block the
      // rest of this tick, and don't surface a toast for a background safety net nobody's
      // watching — just retry on the next tick.
      console.error('Stale-session auto-close failed for record', rec.id, err);
    }
  }
  return true;
}

// A tile's in/lunch/missed status, purely from current state — shared by the full rebuild
// below, the lightweight periodic refresh, and Daily records' missed-clock-in banner, so all
// three can never disagree on the rule. "On lunch" means exactly one session recorded today
// and none currently open — deliberately the same whether that first session ended because
// the employee tapped out themselves or because the auto-close safety net closed it for
// them; a day with 2+ sessions already done doesn't count, so the tile doesn't keep inviting
// a "resume" tap once the day's normal shape is already complete.
export function tileStatus(e){
  const open = state.openSessions[e.id];
  const onLunch = !open && state.sessionsToday[e.id] === 1;
  const missed = !open && !onLunch && isMissedClockIn(state.punchedToday[e.id]);
  return {open, onLunch, missed};
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
    const {open, onLunch, missed} = tileStatus(e);
    const div = document.createElement('div');
    div.dataset.empId = e.id;
    div.className = 'badge-tile' + (open ? ' in' : onLunch ? ' lunch' : missed ? ' missed' : '');
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.innerHTML = '<span class="state-badge"></span><img class="avatar" alt=""><div class="name"></div><div class="status"></div>';
    const avatar = div.querySelector('.avatar');
    applyAvatar(avatar, e);
    avatar.alt = e.name;
    // '↻' (resume) is deliberately its own glyph, not the plain '▶' used for a fresh start —
    // a tap here means "continue where you left off," not "begin," and that distinction
    // shouldn't rely on the employee reading the status text or the tile's border color.
    div.querySelector('.state-badge').textContent = open ? '■' : onLunch ? '↻' : missed ? '!' : '▶';
    div.querySelector('.name').textContent = e.name;
    div.querySelector('.status').innerHTML = open
      ? `Working since ${fmtTime(open.clock_in)}<br>Tap to finish`
      : onLunch ? 'On lunch — tap to resume'
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
    const {open, onLunch, missed} = tileStatus(e);
    tile.className = 'badge-tile' + (open ? ' in' : onLunch ? ' lunch' : missed ? ' missed' : '');
    tile.querySelector('.state-badge').textContent = open ? '■' : onLunch ? '↻' : missed ? '!' : '▶';
    tile.querySelector('.status').innerHTML = open
      ? `Working since ${fmtTime(open.clock_in)}<br>Tap to finish`
      : onLunch ? 'On lunch — tap to resume'
      : missed ? "Hasn't clocked in yet" : 'Tap to start work';
  });
}

function punchTap(emp){
  captureFor(emp, 'punch', blob => handlePunchCapture(emp, blob));
}

async function handlePunchCapture(emp, blob){
  const open = state.openSessions[emp.id];
  let action;
  if(open){
    await store.clockOut(open.id, blob);
    delete state.openSessions[emp.id];
    action = 'out';
  }else{
    const rec = await store.clockIn(emp.id, blob);
    state.openSessions[emp.id] = rec;
    state.punchedToday[emp.id] = true; // avoid a stale "missed" flash until the next refreshAll
    // Same reasoning as punchedToday above: bump this now rather than waiting for the next
    // refreshAll, so tileStatus() doesn't miscount and show "on lunch" again once THIS new
    // session eventually closes (e.g. immediately turning a genuine end-of-day tap back into
    // an apparent "back from lunch" invitation).
    state.sessionsToday[emp.id] = (state.sessionsToday[emp.id] || 0) + 1;
    action = 'in';
  }
  renderHome();
  showPunchConfirm(emp, action, blob, open);
}

function showPunchConfirm(emp, action, blob, priorOpen){
  const el = $('punchConfirm');
  $('pcPhoto').src = URL.createObjectURL(blob);
  $('pcName').textContent = emp.name;
  $('pcAction').textContent = action === 'in' ? 'Clocked IN' : 'Clocked OUT';
  el.classList.remove('in', 'out');
  el.classList.add(action);
  $('pcDetail').textContent = action === 'in'
    ? `Started at ${fmtTime(new Date().toISOString())}`
    : `Worked ${fmtHours((Date.now() - new Date(priorOpen.clock_in))/3600000)} hrs today`;
  el.classList.add('open');
  hapticSuccess();
  clearTimeout(showPunchConfirm._t);
  showPunchConfirm._t = setTimeout(() => el.classList.remove('open'), 1800);
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
// Same 5s cadence covers all of these checks — no separate timer for either auto-close.
// refreshTileStates() (not renderHome()) runs unconditionally, since the missed-clock-in flag
// can flip purely from time passing the cutoff hour — a full renderHome() rebuild here would
// re-fetch every employee's avatar from the network on every tick (see refreshTileStates()).
async function periodicCheck(){
  await checkLunchAutoClose();
  await checkStaleSessionAutoClose();
  refreshTileStates();
  await updateSyncIndicator();
}
periodicCheck();
setInterval(periodicCheck, 5000);
