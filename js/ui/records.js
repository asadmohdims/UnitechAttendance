import { $, busy, toast, dateStr, fmtTime, fmtHours, recHours } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { refreshAll, tileStatus } from './kiosk.js';
import { promptModal } from './modal.js';
import { recHoursRounded, roundToQuarterHour, wasRounded } from '../rounding.js';
import { dayHoursFromSessions, lunchGapIndex } from '../reportMath.js';
import { LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE } from '../config.js';

const recDate = $('recDate');
recDate.value = dateStr();
recDate.onchange = renderRecords;

export function setRecordsDate(date){ recDate.value = date; }

async function showPhoto(path){
  const url = await store.getPhotoUrl(path);
  if(!url) return toast('Photo not found');
  $('photoViewImg').src = url;
  $('photoView').classList.add('open');
}

function punchCell(label, iso, photoPath){
  const cell = document.createElement('div');
  cell.className = 'rec-punch';
  const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = label;
  const val = document.createElement('span'); val.className = 'val';
  val.append(document.createTextNode(fmtTime(iso)));
  if(photoPath){
    // Appended only once a URL actually resolves — an <img> with no src renders as a bare
    // broken-image box, which is worse than just not showing a thumbnail at all.
    store.getPhotoUrl(photoPath).then(u => {
      if(!u) return;
      const img = document.createElement('img');
      img.className = 'photo-thumb';
      img.src = u;
      img.onclick = () => showPhoto(photoPath);
      val.appendChild(img);
    });
  }
  cell.append(lbl, val);
  if(iso && wasRounded(iso)){
    const note = document.createElement('span'); note.className = 'paid-note';
    note.textContent = `→ ${fmtTime(roundToQuarterHour(iso))} paid`;
    cell.appendChild(note);
  }
  return cell;
}

// Shared by a single session's own hours and a multi-session day's combined total — same
// worked/paid pairing logic, just fed different numbers, so the two always read consistently.
function hoursStat(workedHours, paidHours, emphasize){
  const el = document.createElement('div'); el.className = 'rec-hours' + (emphasize ? ' day-total' : '');
  if(paidHours !== null && paidHours !== workedHours){
    el.innerHTML = `<div class="rec-hours-stat"><span class="lbl">Worked</span>${fmtHours(workedHours)}</div>`
      + `<div class="rec-hours-stat paid"><span class="lbl">Paid</span>${fmtHours(paidHours)}</div>`;
  }else{
    el.textContent = fmtHours(workedHours);
  }
  return el;
}

// A day's status in one glance, based on its LAST session — the same "still open, or
// auto-closed and never resumed" check used everywhere else (js/reportMath.js's needsReview).
// Returns null for a normal, fully-resolved day (nothing to flag).
function statusBadge(sessions){
  const last = sessions[sessions.length - 1];
  if(!last.clock_out) return {className: 'open-session', text: '● Still in'};
  if(!last.out_photo) return {className: 'lunch-flag', text: '● Lunch not resumed'};
  return null;
}

function appendBadge(who, sessions){
  const badge = statusBadge(sessions);
  if(!badge) return;
  const el = document.createElement('div'); el.className = badge.className; el.style.fontSize = '13px';
  el.textContent = badge.text;
  who.appendChild(el);
}

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

// `isLunch` distinguishes the day's one real lunch break (see lunchGapIndex() in reportMath.js)
// from any other gap a day with 3+ sessions can have — those render as a plain "Break" instead
// of a second (or third) "Lunch", which is what actually surfaced this: multiple gaps were all
// labeled "Lunch" unconditionally, misreading as several lunch breaks in one day.
function lunchDivider(gapSession, gapHours, auto, isLunch){
  const divider = document.createElement('div');
  divider.className = 'rec-lunch-divider' + (gapSession.lunch_paid ? ' paid' : '');
  const label = document.createElement('span');
  label.textContent = `${isLunch ? 'Lunch' : 'Break'}: ${fmtHours(gapHours)}${auto ? ' (auto)' : ''}`;
  const toggle = document.createElement('button');
  toggle.className = 'btn small ghost lunch-paid-toggle';
  toggle.textContent = gapSession.lunch_paid ? '✓ Paid as work — undo' : 'Include as paid work';
  toggle.onclick = () => toggleLunchPaid(gapSession);
  divider.append(label, toggle);
  return divider;
}

// Manual overtime: a specific number of extra hours the owner adds to one employee's specific
// day, paid at the same hourly rate as regular hours (no multiplier — deliberately simpler than
// the automatic daily/weekly-threshold overtime originally sketched in the backlog, which would
// have needed a basis and multiplier nobody had actually decided on). One row per (emp_id,
// date) — `existingHours` pre-fills the field so this doubles as both Add and Edit. Same
// override-the-refresh shape as toggleLunchPaid/deleteRecordFlow above, so the Report calendar's
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

// The Add/Edit/Remove overtime controls for one employee's day — shared by both row shapes
// below (a single-session day's own actions cluster, or a multi-session day's group header),
// since overtime is a day-level fact that belongs once per employee-day, not once per session.
function overtimeControls(emp, date, overtimeHours, afterSave){
  const frag = document.createDocumentFragment();
  if(!emp) return frag; // no employee to attribute this to (see editRecord's own emp guard)
  if(overtimeHours){
    const bEdit = document.createElement('button');
    bEdit.className = 'btn small ghost'; bEdit.textContent = `OT ${fmtHours(overtimeHours)}`;
    bEdit.title = 'Edit this day’s overtime hours';
    bEdit.onclick = () => addOrEditOvertime(emp.id, emp.name, date, overtimeHours, afterSave);
    const bRemove = document.createElement('button');
    bRemove.className = 'btn small red'; bRemove.textContent = 'Remove OT';
    bRemove.onclick = () => removeOvertime(emp.id, date, afterSave);
    frag.append(bEdit, bRemove);
  }else{
    const bAdd = document.createElement('button');
    bAdd.className = 'btn small ghost'; bAdd.textContent = '+ Overtime';
    bAdd.onclick = () => addOrEditOvertime(emp.id, emp.name, date, null, afterSave);
    frag.append(bAdd);
  }
  return frag;
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

// The punches + this-session's-own hours + edit/delete actions — the part every session has,
// whether it's rendered as a lone `.rec-row` or as one sub-row inside a multi-session `.rec-group`.
// `overtimeHours` is only ever passed by singleSessionRow (where this one session IS the whole
// day) — multiSessionGroup's own per-session calls omit it, since overtime is a day-level fact
// shown once in that group's header, not repeated on every sub-session row.
function sessionContent(r, emp, overtimeHours){
  const punches = document.createElement('div'); punches.className = 'rec-punches';
  punches.append(punchCell('In', r.clock_in, r.in_photo), punchCell('Out', r.clock_out, r.out_photo));

  const paidHours = recHoursRounded(r);
  const hours = hoursStat(recHours(r), paidHours === null ? (overtimeHours || null) : paidHours + (overtimeHours || 0));

  const actions = document.createElement('div'); actions.className = 'rec-actions';
  const bEdit = document.createElement('button'); bEdit.className = 'btn small ghost'; bEdit.textContent = 'Edit'; bEdit.onclick = () => editRecord(r, emp);
  const bDel = document.createElement('button'); bDel.className = 'btn small red'; bDel.textContent = 'Delete';
  bDel.onclick = () => deleteRecordFlow(r, emp);
  actions.append(bEdit, bDel);

  return {punches, hours, actions};
}

// A normal, single-session day — unchanged from before: one full-width row, avatar and all.
function singleSessionRow(r, emp, overtimeHours){
  const row = document.createElement('div');
  row.className = 'rec-row';

  const avatar = document.createElement('img');
  avatar.className = 'report-avatar rec-avatar'; avatar.alt = '';
  if(emp) applyAvatar(avatar, emp);

  const who = document.createElement('div'); who.className = 'rec-who';
  const name = document.createElement('div'); name.className = 'report-name'; name.textContent = emp ? emp.name : '?';
  who.appendChild(name);
  appendBadge(who, [r]);

  const {punches, hours, actions} = sessionContent(r, emp, overtimeHours);
  // Only offered on a closed single session — this is how a genuine "worked straight through,
  // no break" day (currently a .half pill in Report, see reportMath.js's isHalfDay) gets turned
  // into the normal two-session shape everywhere else already reads as a full day.
  if(r.clock_out){
    const bSplit = document.createElement('button');
    bSplit.className = 'btn small ghost'; bSplit.textContent = 'Split for lunch';
    bSplit.title = 'The new lunch gap is unpaid by default — use "Pay this" after if it should be paid';
    bSplit.onclick = () => splitForLunch(r, emp);
    actions.appendChild(bSplit);
  }
  actions.append(overtimeControls(emp, r.date, overtimeHours, renderRecords));
  row.append(avatar, who, punches, hours, actions);
  return row;
}

// Turns one continuous session into two around a lunch gap, for a day that was actually
// worked straight through with no break. Defaults the gap to "paid as work" (lunch_paid) so
// splitting doesn't silently dock pay for a break that was never really taken — the owner can
// un-mark it afterward via the existing lunch-paid toggle if they do want that time excluded.
// The original clock_out's real photo moves to the new, later session rather than being
// duplicated or dropped — the day's last session keeps a genuine out_photo, so it never misreads
// as an unresolved auto-close (see needsReview() in reportMath.js).
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

// A lunch-break day: sessions share one header (avatar, name, status badge, and the day's
// combined total) so a reviewer reads "who, and how much, for today" at a glance — instead of
// two same-weight rows and a lunch gap in between, with the total left as mental arithmetic.
// Individual sessions nest underneath, still showing their own exact times/hours (the audit
// trail), with the lunch toggle between them.
function multiSessionGroup(sessions, emp, overtimeHours){
  const group = document.createElement('div'); group.className = 'rec-group';

  const header = document.createElement('div'); header.className = 'rec-group-header';
  const avatar = document.createElement('img');
  avatar.className = 'report-avatar rec-avatar'; avatar.alt = '';
  if(emp) applyAvatar(avatar, emp);
  const who = document.createElement('div'); who.className = 'rec-who';
  const name = document.createElement('div'); name.className = 'report-name'; name.textContent = emp ? emp.name : '?';
  who.appendChild(name);
  appendBadge(who, sessions);
  const rawPaidTotal = dayHoursFromSessions(sessions, recHoursRounded).total;
  const paidTotal = rawPaidTotal === null ? (overtimeHours || null) : rawPaidTotal + (overtimeHours || 0);
  const dayTotal = hoursStat(dayHoursFromSessions(sessions, recHours).total, paidTotal, true);
  // Overtime is a day-level fact (like the total itself), not per-session — sits beside the
  // total in the header rather than repeated on every session row below.
  const totalWrap = document.createElement('div'); totalWrap.className = 'row';
  totalWrap.append(dayTotal, overtimeControls(emp, sessions[0].date, overtimeHours, renderRecords));
  header.append(avatar, who, totalWrap);
  group.appendChild(header);

  const sessionsWrap = document.createElement('div'); sessionsWrap.className = 'rec-group-sessions';
  const lunchIdx = lunchGapIndex(sessions);
  sessions.forEach((r, i) => {
    if(i > 0){
      const gapSession = sessions[i - 1];
      const gapHours = (new Date(r.clock_in) - new Date(gapSession.clock_out)) / 3600000;
      const auto = !gapSession.out_photo; // out_photo is null only for an auto-close — a manual punch always has one
      sessionsWrap.appendChild(lunchDivider(gapSession, gapHours, auto, i === lunchIdx));
    }
    const {punches, hours, actions} = sessionContent(r, emp);
    const sessionRow = document.createElement('div'); sessionRow.className = 'rec-session-row';
    sessionRow.append(punches, hours, actions);
    sessionsWrap.appendChild(sessionRow);
  });
  group.appendChild(sessionsWrap);
  return group;
}

export async function renderRecords(){
  const list = $('recList');
  list.innerHTML = '';
  busy(true);
  let records;
  try{
    records = await store.listRecordsForDate(recDate.value);
  }catch(err){
    busy(false);
    return toast('Load failed: ' + err.message);
  }
  // Best-effort: a fresh environment that hasn't run the overtime_hours migration yet (or a
  // transient offline read) shouldn't break the rest of the day's records — same fail-soft
  // spirit as day_pay_overrides elsewhere in this app.
  let overtimeRows = [];
  try{ overtimeRows = await store.listOvertimeForRange(recDate.value, recDate.value); }catch(err){ /* see comment above */ }
  const overtimeByEmp = {};
  overtimeRows.forEach(o => { overtimeByEmp[o.emp_id] = Number(o.hours); });
  busy(false);
  $('recEmpty').style.display = records.length ? 'none' : '';
  $('recCountLabel').textContent = records.length ? `${records.length} ${records.length === 1 ? 'entry' : 'entries'}` : '';
  renderMissedAlert();

  // listRecordsForDate sorts by clock_in globally, which can interleave different employees'
  // sessions on a lunch-break day (A-in, B-in, A-lunch-out, B-lunch-out, ...) — group by
  // employee (keeping each one's own chronological order) so a same-day second session always
  // renders as part of the same person's group, never interleaved with someone else's.
  const byEmp = new Map();
  records.forEach(r => { if(!byEmp.has(r.emp_id)) byEmp.set(r.emp_id, []); byEmp.get(r.emp_id).push(r); });

  byEmp.forEach((sessions, empId) => {
    const emp = state.employees.find(e => e.id === empId);
    const overtimeHours = overtimeByEmp[empId];
    list.appendChild(sessions.length > 1 ? multiSessionGroup(sessions, emp, overtimeHours) : singleSessionRow(sessions[0], emp, overtimeHours));
  });
}

// Only meaningful for today's date — "missed clock-in" isn't a retroactive judgment about a
// past day, so browsing history never shows it. Reads shared `state` directly rather than
// fetching: js/ui/kiosk.js's periodicCheck() keeps openSessions/sessionsToday/punchedToday
// live regardless of which admin tab is active. Reuses tileStatus() (same function the kiosk
// tiles use) rather than re-deriving the same open/on-lunch/missed rule here a second time.
function renderMissedAlert(){
  const el = $('missedAlert');
  if(recDate.value !== dateStr()){ el.style.display = 'none'; return; }
  const missed = state.employees.filter(e => e.active && tileStatus(e).missed);
  el.style.display = missed.length ? '' : 'none';
  if(missed.length){
    $('missedTitle').textContent = `${missed.length} ${missed.length === 1 ? "employee hasn't" : "employees haven't"} clocked in today`;
    $('missedText').textContent = missed.map(e => e.name).join(', ');
  }
}

export async function editRecord(r, emp, afterSave = renderRecords){
  const result = await promptModal({
    title: `Edit — ${emp ? emp.name : 'record'}`,
    fields: [
      {name:'clockIn', label:'Clock in', type:'time', value: new Date(r.clock_in).toTimeString().slice(0,5)},
      {name:'clockOut', label:'Clock out (leave empty if still in)', type:'time', value: r.clock_out ? new Date(r.clock_out).toTimeString().slice(0,5) : '', required:false}
    ]
  });
  if(!result) return;
  const mk = hhmm => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(r.date + 'T00:00:00');
    d.setHours(h, m, 0, 0);
    return d;
  };
  const inD = mk(result.clockIn);
  let outD = null;
  if(result.clockOut){
    outD = mk(result.clockOut);
    if(outD < inD) outD = new Date(outD.getTime() + 86400000); // crossed midnight
  }
  busy(true);
  try{
    await store.updateRecordTimes(r.id, inD.toISOString(), outD ? outD.toISOString() : null);
    await refreshAll();
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// Backfills a punch for a day that has no record at all — an absence turning out to have
// actually been a missed punch (tablet down, forgot to tap), not a genuine no-show. Only ever
// reachable for a red "Absent" pill (js/ui/report.js), which by dayOffStatus()'s own gate
// (reportMath.js) can only be a past-or-today date for an already-hired employee — never the
// future or before they joined, so no separate date guard is needed here.
export async function addMissedPunch(emp, date, afterSave = renderRecords){
  const result = await promptModal({
    title: `Add a missed punch — ${emp.name}`,
    submitLabel: 'Add',
    fields: [
      {name:'clockIn', label:'Clock in', type:'time'},
      {name:'clockOut', label:'Clock out (leave empty if still in)', type:'time', required:false}
    ]
  });
  if(!result) return;
  const mk = hhmm => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(date + 'T00:00:00');
    d.setHours(h, m, 0, 0);
    return d;
  };
  const inD = mk(result.clockIn);
  let outD = null;
  if(result.clockOut){
    outD = mk(result.clockOut);
    if(outD < inD) outD = new Date(outD.getTime() + 86400000); // crossed midnight
  }
  busy(true);
  try{
    await store.addManualRecord(emp.id, date, inD.toISOString(), outD ? outD.toISOString() : null);
    await refreshAll();
    await afterSave();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}
