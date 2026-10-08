import { $, busy, toast, dateStr, fmtTime, fmtHours, recHours } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { refreshAll } from './kiosk.js';
import { promptModal } from './modal.js';
import { buildEntryTimes } from '../timeEntry.js';
import { paidPunchTime } from '../rounding.js';
import { isAutoClosedSession } from '../autoClosed.js';
import { dayModel, emptyDayModel } from '../dayStatus.js';
import { LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE } from '../config.js';

const recDate = $('recDate');
recDate.value = dateStr();
recDate.onchange = () => renderRecords();

export function setRecordsDate(date){ recDate.value = date; }
// Opens Daily records on one person's day (the Report's phone view hands off here instead of
// duplicating the editing screens). The caller switches the tab, which renders.
// `onBack` (optional) makes the phone's Back button return to wherever the owner came from, instead of
// to this tab's list.
export function showPersonDay(date, empId, onBack = null){ recDate.value = date; selectedEmpId = empId; showDetail = true; returnTo = onBack; }
// Called when another tab is opened, so a stale "back to the Report" never outlives that trip.
export function clearRecordsReturn(){ returnTo = null; }

// ---------- layout state ----------
// On wide screens the list and the selected person's detail sit side by side. On a phone only one
// shows at a time: the list, then (after a tap) the person, with a back button.
let selectedEmpId = null;
let showDetail = false;
let returnTo = null;
const layout = $('recLayout');
function syncLayout(){ layout.classList.toggle('show-detail', showDetail); }

function shiftDay(n){
  const d = new Date(recDate.value + 'T12:00:00');
  d.setDate(d.getDate() + n);
  recDate.value = dateStr(d);
  showDetail = false; returnTo = null;
  renderRecords();
}
$('recPrev').onclick = () => shiftDay(-1);
$('recNext').onclick = () => shiftDay(1);
// The real <input type=date> stays in the page (other screens set it, and it holds the value) but
// is visually replaced by the date label; tapping the label opens its native picker.
$('recDateBtn').onclick = () => { if(recDate.showPicker) recDate.showPicker(); else recDate.focus(); };

async function showPhoto(path){
  const url = await store.getPhotoUrl(path);
  if(!url) return toast('Photo not found');
  $('photoViewImg').src = url;
  $('photoView').classList.add('open');
}

// ---------- tiny DOM helper ----------
function h(tag, cls, ...children){
  const node = document.createElement(tag);
  if(cls) node.className = cls;
  children.flat().forEach(c => { if(c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(c)); });
  return node;
}
function button(cls, label, onclick, attrs = {}){
  const b = h('button', cls, label);
  b.type = 'button';
  b.onclick = onclick;
  Object.entries(attrs).forEach(([k, v]) => b.setAttribute(k, v));
  return b;
}

// "1 hr 3 min", "45 min", "2 hr" — for gaps, where the H:MM of paid hours would read as a clock time.
function fmtGap(hours){
  const m = Math.max(0, Math.round(hours * 60));
  const hr = Math.floor(m / 60), min = m % 60;
  if(!hr) return `${min} min`;
  return min ? `${hr} hr ${min} min` : `${hr} hr`;
}
const fmtDay = (date, opts) => new Date(date + 'T12:00:00').toLocaleDateString('en-IN', opts);
const fmtDateTime = iso => `${new Date(iso).toLocaleDateString('en-IN', {day:'numeric', month:'short'})}, ${fmtTime(iso)}`;

// ---------- actions shared with the Report calendar's day-detail panel ----------
// gapSession: the session whose clock_out starts the gap — `lunch_paid` lives on it, and it's
// what setLunchPaid() targets. Toggling is the only mechanism here: no separate confirm step,
// because the flag is instantly reversible by tapping again — a mistaken tap costs one more tap.
// `afterSave` defaults to re-rendering this tab, but is overridable so another screen (the
// Report calendar's day-detail panel) can reuse the exact same toggle and refresh itself instead.
export async function toggleLunchPaid(gapSession, afterSave = renderRecords){
  busy(true);
  try{
    await store.setLunchPaid(gapSession.id, !gapSession.lunch_paid);
    await refreshAll();
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// Manual overtime: a specific number of extra hours the owner adds to one employee's specific
// day, paid at the same hourly rate as regular hours (no multiplier — deliberately simpler than
// the automatic daily/weekly-threshold overtime originally sketched in the backlog, which would
// have needed a basis and multiplier nobody had actually decided on). One row per (emp_id,
// date) — `existingHours` pre-fills the field so this doubles as both Add and Edit. Same
// override-the-refresh shape as toggleLunchPaid/deleteRecordFlow, so the Report calendar's
// day-detail panel can reuse this exact flow instead of a second implementation.
export async function addOrEditOvertime(empId, empName, date, existingHours, afterSave = renderRecords){
  const result = await promptModal({
    title: `${existingHours ? 'Edit' : 'Add'} overtime — ${empName}`,
    fields: [{name:'hours', label:'Overtime hours', type:'number', value: existingHours || '', placeholder:'e.g. 2', min:0.25}]
  });
  if(!result) return;
  const hours = Number(result.hours);
  if(!hours || hours <= 0) return toast('Enter a valid number of hours.');
  busy(true);
  try{
    await store.setOvertimeHours(empId, date, hours);
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

export async function removeOvertime(empId, date, afterSave = renderRecords){
  busy(true);
  try{
    await store.deleteOvertimeHours(empId, date);
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// Same override-the-refresh shape as toggleLunchPaid() above, so the Report calendar's
// day-detail panel can offer the identical delete-with-confirm flow instead of duplicating it.
export async function deleteRecordFlow(r, emp, afterSave = renderRecords){
  const confirmed = await promptModal({
    title: `Delete this record for ${emp ? emp.name : 'this employee'}?`,
    submitLabel: 'Delete', danger: true, fields: []
  });
  if(!confirmed) return;
  busy(true);
  try{
    await store.deleteRecord(r);
    await refreshAll();
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// Turns one continuous session into two around a lunch gap, for a day that was actually
// worked straight through with no break. The original clock_out's real photo moves to the new,
// later session rather than being duplicated or dropped — the day's last session keeps a genuine
// out_photo, so it never misreads as a day closed without a clock-out photo (see needsReview()
// in reportMath.js).
// One click, one hour, no time-picker — the owner reaches for this specifically when a long
// unbroken session almost certainly hid a real lunch (see isPossibleMissedLunch() in
// reportMath.js), and picking exact start/end times for a break nobody photographed added
// friction without adding real accuracy. Defaults the gap to the shop's usual lunch time
// (LUNCH_CUTOFF_HOUR/MINUTE, ±30min) when that window actually fits inside the session, falling
// back to the session's own midpoint otherwise (e.g. a shift that doesn't span 1pm at all) — so
// the split always lands somewhere plausible without ever needing input. Session times are still
// editable afterward (Edit on either resulting half) if the guess needs nudging.
function defaultLunchWindow(clockIn, clockOut){
  const cutoff = new Date(clockIn);
  cutoff.setHours(LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE, 0, 0);
  const halfHourMs = 30 * 60000, bufferMs = 5 * 60000;
  let start = new Date(cutoff - halfHourMs), end = new Date(cutoff.getTime() + halfHourMs);
  const fitsAtCutoff = (clockIn.getTime() + bufferMs <= start.getTime()) && (end.getTime() + bufferMs <= clockOut.getTime());
  if(!fitsAtCutoff){
    const mid = new Date((clockIn.getTime() + clockOut.getTime()) / 2);
    start = new Date(mid.getTime() - halfHourMs);
    end = new Date(mid.getTime() + halfHourMs);
  }
  return {start, end};
}

export async function splitForLunch(r, emp, afterSave = renderRecords){
  const clockIn = new Date(r.clock_in), clockOut = new Date(r.clock_out);
  // Needs a sliver of real work on both sides of the hour-long gap, or the split is meaningless.
  if((clockOut - clockIn) < 70 * 60000){
    return toast('This session is too short to split off a 1-hour lunch.');
  }
  const {start: lunchStart, end: lunchEnd} = defaultLunchWindow(clockIn, clockOut);
  busy(true);
  try{
    await store.splitSessionForLunch(r.id, lunchStart.toISOString(), lunchEnd.toISOString());
    await refreshAll();
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// ---------- the list ----------
function personRow(entry){
  const {emp, model} = entry;
  const avatar = h('img', 'rec-avatar'); avatar.alt = '';
  applyAvatar(avatar, emp);
  const who = h('div', 'rec-who', h('div', 'rec-name', emp.name));
  if(model.chip) who.append(h('span', `chip ${model.chip.tone}`, h('i'), model.chip.text));
  const paid = h('div', 'rec-paid' + (model.paidTotal === null ? ' none' : ''), model.paidTotal === null ? '—' : fmtHours(model.paidTotal));
  const row = button('rec-person' + (emp.id === selectedEmpId ? ' selected' : ''), [avatar, who, paid], () => {
    selectedEmpId = emp.id; showDetail = true; returnTo = null;
    renderRecordsFromCache();
  });
  row.dataset.empId = emp.id;
  return row;
}

function renderList(entries, date){
  const list = $('recList');
  list.innerHTML = '';
  const needs = entries.filter(e => e.model.needsLook);
  const rest = entries.filter(e => !e.model.needsLook);
  const stillIn = entries.filter(e => e.model.chip && e.model.chip.id === 'still-in').length;
  const summary = $('recSummary');
  summary.replaceChildren(h('b', null, String(entries.length)), entries.length === 1 ? ' person' : ' people');
  if(needs.length) summary.append(' · ', h('b', 'warn', String(needs.length)), ' need a look');
  if(stillIn) summary.append(' · ', h('b', null, String(stillIn)), ' still in');
  if(!entries.length){
    list.append(h('p', 'rec-empty', 'No one to show for this day.'));
    return;
  }
  const section = (title, items) => {
    if(!items.length) return;
    if(title) list.append(h('div', 'rec-section', title));
    list.append(h('div', 'rec-people', items.map(personRow)));
  };
  section(needs.length ? 'NEEDS A LOOK' : null, needs);
  section(needs.length ? 'EVERYONE ELSE' : null, rest);
}

// ---------- the detail ----------
function slot(type, view, side){
  const r = view.record;
  const path = side === 'in' ? r.in_photo : r.out_photo;
  if(type === 'photo'){
    const box = h('div', 'rec-ph photo');
    // Appended only once a URL actually resolves — an <img> with no src renders as a bare
    // broken-image box, which is worse than leaving the placeholder silhouette in place.
    store.getPhotoUrl(path).then(u => {
      if(!u) return;
      const img = h('img'); img.src = u; img.alt = '';
      box.append(img);
      box.classList.add('loaded');
      box.onclick = () => showPhoto(path);
    });
    return box;
  }
  const text = {
    'not-yet': 'Not yet',
    'auto': `Closed automatically ${fmtTime(r.clock_out)}`,
    'owner': 'Entered by you',
    'uploading': 'Uploading…',
    'missing': 'No photo'
  }[type];
  return h('div', `rec-ph empty ${type}`, text);
}

function caption(kind, iso, view, side){
  const r = view.record;
  const type = view.slots[side];
  const cap = h('div', 'rec-cap', h('i', null, kind));
  if(type === 'not-yet'){ cap.append(h('b', 'muted', '—')); return cap; }
  if(type === 'auto'){ cap.append(h('b', 'flag', 'no tap')); return cap; }
  const flagged = side === 'in' && view.flagIn;
  cap.append(h('b', flagged ? 'flag' : null, fmtTime(iso)));
  const countedIso = side === 'out' ? view.countedOut : iso;
  const paid = paidPunchTime(iso, countedIso);
  if(paid) cap.append(h('u', null, `counts as ${fmtTime(paid.toISOString())}`));
  if(flagged) cap.append(h('u', 'flag', 'after closing'));
  // What the kiosk captured before the owner changed it — never silently amended.
  const orig = side === 'in' ? r.orig_clock_in : r.orig_clock_out;
  // Compared as shown (to the minute): an edit that kept a time keeps its exact instant too, so
  // anything that still reads the same on screen is not worth a note.
  if(r.edited_at && orig && fmtTime(orig) !== fmtTime(iso)){
    const wasAuto = side === 'out' && isAutoClosedSession({...r, clock_out: orig});
    cap.append(h('u', 'edit', wasAuto ? `was: closed automatically ${fmtTime(orig)}`
      : type === 'photo' ? `photo taken at ${fmtTime(orig)}` : `was ${fmtTime(orig)}`));
  }
  return cap;
}

function openMenu(anchor, items){
  document.querySelectorAll('.rec-menu').forEach(m => m.remove());
  const menu = h('div', 'rec-menu', items.map(i => button('rec-menu-item' + (i.danger ? ' danger' : ''), i.label, () => { menu.remove(); i.run(); })));
  const rect = anchor.getBoundingClientRect();
  document.body.append(menu);
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;
  const close = e => { if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('click', close, true); } };
  setTimeout(() => document.addEventListener('click', close, true));
}

function sessionCard(view, emp, model, compact){
  const r = view.record;
  const card = h('div', 'rec-sess' + (view.edited ? ' edited' : '') + (compact ? ' compact' : ''));
  const menuItems = [];
  if(model.sessions.length === 1 && r.clock_out) menuItems.push({label: 'Split for lunch', run: () => splitForLunch(r, emp)});
  menuItems.push({label: 'Delete session…', danger: true, run: () => deleteRecordFlow(r, emp)});
  const head = h('div', 'rec-sess-head', h('span', 'rec-sess-title', view.label),
    h('span', 'rec-sess-actions',
      view.edited ? h('span', 'chip blue', h('i'), `Edited ${fmtDateTime(r.edited_at)}`) : null,
      button('btn small ghost', 'Edit', () => editRecord(r, emp)),
      (() => { const b = button('btn small ghost icon', '⋯', () => openMenu(b, menuItems), {'aria-label': 'More for this session'}); return b; })()));

  let midNumber, midLabel, midMuted = false;
  if(view.paid !== null){ midNumber = fmtHours(view.paid); midLabel = view.slots.out === 'auto' ? 'PAID TO CLOSING' : 'PAID'; midMuted = view.paid === 0; }
  else if(view.soFar !== null){ midNumber = fmtHours(view.soFar); midLabel = 'SO FAR'; midMuted = true; }
  else { midNumber = '—'; midLabel = 'NOT COUNTED'; midMuted = true; }

  const flow = h('div', 'rec-flow',
    h('div', 'rec-end', slot(view.slots.in, view, 'in'), caption('CLOCKED IN', r.clock_in, view, 'in')),
    h('div', 'rec-mid', h('b', midMuted ? 'muted' : null, midNumber), h('i', null, midLabel)),
    h('div', 'rec-end', slot(view.slots.out, view, 'out'), caption('CLOCKED OUT', r.clock_out, view, 'out')));
  card.append(head, flow);
  return card;
}

function gapRow(prevView, nextView, isLunch){
  const prev = prevView.record, next = nextView.record;
  const gapHours = (new Date(next.clock_in) - new Date(prev.clock_out)) / 3600000;
  if(gapHours < 0){
    return h('div', 'rec-gap warn', h('span', null, h('b', null, `Overlap ${fmtGap(-gapHours)}`), ' · both sessions are paid for this time'));
  }
  const paid = !!prev.lunch_paid;
  return h('div', 'rec-gap' + (paid ? ' paid' : ''),
    h('span', null, `${isLunch ? 'Lunch' : 'Break'} `, h('b', null, fmtGap(gapHours)), paid ? ' · paid as work ✓' : ' · not paid'),
    button('btn small ghost', paid ? 'Undo' : 'Pay as work', () => toggleLunchPaid(prev)));
}

// Exported so the Report's phone view can say the same thing, in the same words, about a day.
export function calloutText(model, emp, date){
  const c = model.callout;
  const name = emp.name;
  const sess = i => model.sessions[i].record;
  switch(c.id){
    case 'syncing': return ['Saved on the tablet.', 'It uploads when Wi-Fi returns. Nothing to do.'];
    case 'still-in': return [`In since ${fmtTime(c.params.since)}.`, `Hours count once ${name} clocks out.`];
    case 'needs-clock-out': return ['No clock-out tap.', `The system closed it at ${fmtTime(c.params.closedAt)}. Pay counts to ${fmtTime(c.params.countedTo)} (${fmtHours(c.params.paid)}) until you enter the real time.`];
    case 'open-past': return ['Never clocked out.', `This session is still open from ${fmtDay(date, {weekday:'short', day:'numeric', month:'short'})}. Enter the real clock-out time.`];
    case 'check-punches': {
      const p = c.params.problems[0];
      const more = c.params.problems.length > 1 ? ` (${c.params.problems.length - 1} more to check)` : '';
      const soFar = c.params.paid != null ? ` Pay so far: ${fmtHours(c.params.paid)}.` : '';
      if(p.kind === 'late-start') return ["This day doesn't look normal.", `The last session started at ${fmtTime(sess(p.index).clock_in)}, after closing. A punch may be missing.${soFar}${more}`];
      if(p.kind === 'short') return [`A ${p.minutes}-minute session at ${fmtTime(sess(p.index).clock_in)}.`, `Probably an accidental tap. It adds almost nothing to pay.${more}`];
      if(p.kind === 'long') return [`One session of ${fmtHours(p.hours)}.`, `That is longer than a normal day. Check the times.${more}`];
      if(p.kind === 'overlap') return [`Session ${p.index + 1} starts at ${fmtTime(sess(p.index).clock_in)}, before session ${p.index} ends at ${fmtTime(sess(p.index - 1).clock_out)}.`, `Pay counts both, so ${p.minutes} minutes are paid twice.${more}`];
      return ['Check these punches.', ''];
    }
    case 'no-lunch': return ['One long session with no lunch punch.', `If ${name} took a lunch break, use Split for lunch.`];
    case 'edited': return ['You changed the times on this day.', `Last edit ${fmtDateTime(c.params.editedAt)}. The kiosk's original times are kept on each edited session.`];
    case 'added': return ['You added this day.', `${fmtDateTime(c.params.editedAt)}. There are no photos because nobody was at the kiosk.`];
    case 'half-day': return ['Half day.', `One session of ${fmtHours(c.params.hours)}, so there is no lunch to look for.`];
    case 'not-in-yet': return ['No punches yet today.', 'Nothing to do until you expect them.'];
    case 'absent': return [`No punches on ${fmtDay(date, {weekday:'short', day:'numeric', month:'short'})}.`, `If ${name} was actually in, add the missed punch.`];
    case 'holiday': return [`${fmtDay(date, {weekday:'long'})} is the weekly holiday.`, c.params.docked ? `You marked it unpaid for ${name} this month.` : 'Paid without punches.'];
    default: return ['', ''];
  }
}

function runAction(a, model, emp, date){
  const rec = a.index != null ? model.sessions[a.index].record : null;
  if(a.id === 'edit-session') return editRecord(rec, emp);
  if(a.id === 'delete-session') return deleteRecordFlow(rec, emp);
  if(a.id === 'split') return splitForLunch(rec, emp);
  if(a.id === 'add-punch') return addMissedPunch(emp, date);
  if(a.id === 'toggle-holiday') return toggleHolidayPay(emp, date, model.callout.params.docked);
}

// Excludes one paid Friday from one person's pay (or puts it back) — the same reversible, no-confirm
// toggle the Report's day panel has, via the same store call (`paid` is the opposite of "docked").
async function toggleHolidayPay(emp, date, currentlyDocked){
  busy(true);
  try{
    await store.setDayOverride(emp.id, date, currentlyDocked);
    await renderRecords();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

function renderDetail(entry, date){
  const pane = $('recDetail');
  pane.innerHTML = '';
  if(!entry){ pane.append(h('p', 'rec-empty', 'Pick a person to see their day.')); return; }
  const {emp, model, overtimeHours} = entry;

  const avatar = h('img', 'rec-avatar big'); avatar.alt = ''; applyAvatar(avatar, emp);
  const head = h('div', 'rec-detail-head',
    button('btn small ghost rec-back', returnTo ? '‹ Report' : '‹ Back', () => {
      showDetail = false;
      const back = returnTo; returnTo = null;
      if(back) back(); else syncLayout();
    }, {'aria-label': returnTo ? 'Back to the Report' : 'Back to the day'}),
    avatar,
    h('div', 'rec-detail-who', h('div', 'rec-detail-date', fmtDay(date, {weekday:'short', day:'numeric', month:'short', year:'numeric'})), h('h2', null, emp.name)),
    model.kind === 'worked' && !overtimeHours
      ? button('btn small ghost', '+ Overtime', () => addOrEditOvertime(emp.id, emp.name, date, null)) : null);
  pane.append(head);

  if(model.callout){
    const [lead, rest] = calloutText(model, emp, date);
    const box = h('div', `callout ${model.callout.tone}`, h('div', 'callout-text', h('b', null, lead), ' ', rest));
    const actions = model.callout.actions;
    if(actions.length){
      box.append(h('div', 'callout-actions', actions.map(a => button('btn small' + (a.primary ? ' green' : ' ghost'), a.label, () => runAction(a, model, emp, date)))));
    }
    pane.append(box);
  }

  if(model.kind === 'empty'){ pane.append(h('div', 'rec-none', 'No sessions to show')); return; }

  const anyOpen = model.sessions.some(v => v.record.clock_out === null);
  pane.append(h('div', 'rec-strip',
    h('div', null, h('b', 'paid', model.paidTotal === null ? '—' : fmtHours(model.paidTotal)), h('span', null, anyOpen ? 'PAID SO FAR' : 'PAID TODAY')),
    h('div', null, h('b', null, String(model.sessions.length)), h('span', null, model.sessions.length === 1 ? 'SESSION' : 'SESSIONS')),
    h('div', null, h('b', null, model.lunch ? fmtGap(model.lunch.hours) : '—'), h('span', null, model.lunch ? (model.lunch.paid ? 'LUNCH, PAID AS WORK' : 'LUNCH, UNPAID') : 'LUNCH'))));

  const compact = model.sessions.length >= 3;
  const stack = h('div', 'rec-stack');
  model.sessions.forEach((view, i) => {
    if(i > 0 && model.sessions[i - 1].record.clock_out){
      stack.append(gapRow(model.sessions[i - 1], view, model.lunch && model.lunch.index === i));
    }
    stack.append(sessionCard(view, emp, model, compact));
  });
  pane.append(stack);

  if(overtimeHours){
    pane.append(h('div', 'rec-overtime',
      h('span', null, h('b', null, `Overtime ${fmtHours(overtimeHours)}`), ' · added by you, paid at the normal hourly rate'),
      h('span', 'rec-sess-actions',
        button('btn small ghost', 'Edit', () => addOrEditOvertime(emp.id, emp.name, date, overtimeHours)),
        button('btn small ghost', 'Remove', () => removeOvertime(emp.id, date)))));
  }

  const rounded = model.sessions.some(v => v.paid !== null && Math.abs(v.paid - recHours(v.record)) > 0.001);
  if(rounded){
    pane.append(h('p', 'rec-foot', 'Pay counts each punch to the nearest quarter hour, with up to 10 minutes of grace. The exact times above are what the kiosk recorded.'));
  }
}

// ---------- render ----------
let cache = null; // {date, entries} — lets a row tap re-render without another round trip

function renderRecordsFromCache(){
  const {date, entries} = cache;
  if(!entries.some(e => e.emp.id === selectedEmpId)){
    const first = entries.find(e => e.model.needsLook) || entries[0];
    selectedEmpId = first ? first.emp.id : null;
  }
  renderList(entries, date);
  renderDetail(entries.find(e => e.emp.id === selectedEmpId), date);
  syncLayout();
}

function updateDateBar(date){
  const today = dateStr();
  const y = new Date(); y.setDate(y.getDate() - 1);
  $('recDateLabel').textContent = fmtDay(date, {weekday:'short', day:'numeric', month:'short'});
  $('recDateSub').textContent = date === today ? 'Today' : date === dateStr(y) ? 'Yesterday' : fmtDay(date, {year:'numeric'});
  $('recNext').disabled = date >= today;
}

export async function renderRecords(){
  const date = recDate.value;
  updateDateBar(date);
  busy(true);
  let records;
  try{
    records = await store.listRecordsForDate(date);
  }catch(err){
    busy(false);
    return toast('Load failed: ' + err.message);
  }
  // Best-effort: a fresh environment that hasn't run the overtime_hours migration yet (or a
  // transient offline read) shouldn't break the rest of the day's records — same fail-soft
  // spirit as day_pay_overrides elsewhere in this app.
  let overtimeRows = [];
  try{ overtimeRows = await store.listOvertimeForRange(date, date); }catch(err){ /* see comment above */ }
  const overtimeByEmp = {};
  overtimeRows.forEach(o => { overtimeByEmp[o.emp_id] = Number(o.hours); });
  // Same best-effort read for the "paid holiday marked unpaid" overrides (only used on a holiday).
  let overrides = [];
  try{ overrides = await store.listDayPayOverrides(date, date); }catch(err){ /* see above */ }
  const dockedEmps = new Set(overrides.filter(o => o.paid === false).map(o => o.emp_id));
  busy(false);

  // listRecordsForDate sorts by clock_in globally, which can interleave different employees'
  // sessions — group by employee (keeping each one's own chronological order).
  const byEmp = new Map();
  records.forEach(r => { if(!byEmp.has(r.emp_id)) byEmp.set(r.emp_id, []); byEmp.get(r.emp_id).push(r); });

  const today = dateStr(), now = new Date();
  const weekday = new Date(date + 'T12:00:00').getDay();
  // Everyone who is active gets a row — including on days with no punches (Absent, Not in yet,
  // Holiday) — plus anyone inactive who still has records that day.
  const roster = state.employees.filter(e => e.active || byEmp.has(e.id));
  const entries = [];
  roster.forEach(emp => {
    const sessions = byEmp.get(emp.id);
    const overtimeHours = overtimeByEmp[emp.id] || 0;
    const since = emp.created_at ? dateStr(new Date(emp.created_at)) : undefined;
    const model = sessions
      ? dayModel({sessions, date, today, now, overtimeHours})
      : emptyDayModel({date, today, weekday, employeeSince: since, now, docked: dockedEmps.has(emp.id)});
    if(model) entries.push({emp, model, overtimeHours});
  });
  // Needs-a-look first (and the rest in roster order), so what matters is at the top.
  entries.sort((a, b) => (b.model.needsLook - a.model.needsLook));
  cache = {date, entries};
  renderRecordsFromCache();
}

// What the owner is about to change, in plain words: which day, what the kiosk recorded, and whether
// it has been edited before. Shown at the top of the Edit dialog, which used to say only a name.
function editNote(r){
  const day = fmtDay(r.date, {weekday:'short', day:'numeric', month:'short', year:'numeric'});
  const when = (inIso, outIso) => `${fmtTime(inIso)} to ${outIso ? fmtTime(outIso) : 'still in'}`;
  if(r.edited_at){
    const kiosk = r.orig_clock_in || r.orig_clock_out
      ? `The kiosk recorded ${when(r.orig_clock_in || r.clock_in, r.orig_clock_out)}. Last edited ${fmtDateTime(r.edited_at)}.`
      : `You added this record on ${fmtDateTime(r.edited_at)}.`;
    return [day, kiosk];
  }
  const closed = isAutoClosedSession(r) ? ' The kiosk closed it automatically, so enter the real clock-out.' : '';
  return [day, `The kiosk recorded ${when(r.clock_in, r.clock_out)}.${closed}`];
}

export async function editRecord(r, emp, afterSave = renderRecords){
  const result = await promptModal({
    title: `Edit — ${emp ? emp.name : 'record'}`,
    note: editNote(r),
    fields: [
      {name:'clockIn', label:'Clock in', type:'time', value: new Date(r.clock_in).toTimeString().slice(0,5)},
      {name:'clockOut', label:'Clock out (leave empty if still in)', type:'time', value: r.clock_out ? new Date(r.clock_out).toTimeString().slice(0,5) : '', required:false}
    ],
    // Refuse instead of guessing "it must have crossed midnight" (see js/timeEntry.js).
    validate: v => buildEntryTimes(r.date, v.clockIn, v.clockOut, r).error || null
  });
  if(!result) return;
  const times = buildEntryTimes(r.date, result.clockIn, result.clockOut, r);
  // Nothing actually changed (same minutes): write nothing, so the exact punch seconds and the
  // "edited" marker are not touched by an open-and-save.
  if(!times.changed) return toast('No changes to save.');
  busy(true);
  try{
    await store.updateRecordTimes(r.id, times.inIso, times.outIso);
    await refreshAll();
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// Backfills a punch for a day that has no record at all — an absence turning out to have
// actually been a missed punch (tablet down, forgot to tap), not a genuine no-show. Also offered
// from a "Check punches" day, where a tap in the middle of the day was missed.
export async function addMissedPunch(emp, date, afterSave = renderRecords){
  const result = await promptModal({
    title: `Add a missed punch — ${emp.name}`,
    note: [fmtDay(date, {weekday:'short', day:'numeric', month:'short', year:'numeric'}), 'This adds punches that were never recorded, so there will be no photos.'],
    submitLabel: 'Add',
    fields: [
      {name:'clockIn', label:'Clock in', type:'time'},
      {name:'clockOut', label:'Clock out (leave empty if still in)', type:'time', required:false}
    ],
    validate: v => buildEntryTimes(date, v.clockIn, v.clockOut).error || null
  });
  if(!result) return;
  const times = buildEntryTimes(date, result.clockIn, result.clockOut);
  busy(true);
  try{
    await store.addManualRecord(emp.id, date, times.inIso, times.outIso);
    await refreshAll();
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}
