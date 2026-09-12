import { $, busy, toast, pad, fmtHours, fmtTime, recHours, dateStr, shiftMonthInput } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { switchTab } from './shell.js';
import { setRecordsDate, editRecord, deleteRecordFlow, toggleLunchPaid, splitForLunch, addMissedPunch } from './records.js';
import { infoModal } from './modal.js';
import { buildDayHours, groupByEmployeeDay, needsReview, dayHoursFromSessions, dayOffStatus, isHalfDay, lunchGapIndex, isPossibleMissedLunch } from '../reportMath.js';
import { recHoursRounded, roundToQuarterHour, wasRounded } from '../rounding.js';

const repMonth = $('repMonth');
repMonth.value = dateStr().slice(0,7);
repMonth.onchange = renderReport;
let lastReportData = null;
// Which day's detail panel (if any) should stay open across a re-render — set on open/close,
// read by renderDetailCalendar() to restore it after an inline edit rebuilds the whole table.
// Keyed by employee id + day-of-month rather than a DOM reference, since a save always rebuilds
// every row from scratch.
let openDetailKey = null;

$('btnPrevMonth').onclick = () => shiftMonthInput(repMonth, -1, renderReport);
$('btnNextMonth').onclick = () => shiftMonthInput(repMonth, 1, renderReport);
// Opens the first flagged record's day directly in the calendar below, instead of switching to
// Daily records — now that the calendar itself can fix a flagged entry (edit/delete/lunch-toggle,
// see renderDayDetail() below), there's no reason to leave this tab to do it.
$('btnReviewRecords').onclick = () => {
  const first = lastReportData?.reviewRecords?.[0];
  if(!first) return;
  const day = Number(first.date.slice(8,10));
  const tr = Array.from(document.querySelectorAll('#reportTable tbody > tr')).find(t => t._empId === first.emp_id);
  const sessions = lastReportData.sessionsByDay[first.emp_id]?.[day];
  const emp = lastReportData.emps.find(e => e.id === first.emp_id);
  if(!tr || !sessions || !emp) return;
  openDetailKey = `${first.emp_id}:${day}`;
  renderDayDetail(tr._detailRow, tr._detailInner, sessions, emp, day);
  tr.scrollIntoView({block:'center', behavior:'smooth'});
};

export async function monthData(ym){ // ym: 'YYYY-MM'
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  let recs;
  try{
    recs = await store.listRecordsForRange(`${ym}-01`, `${ym}-${pad(days)}`);
  }catch(err){
    toast('Load failed: ' + err.message);
    return null;
  }
  const emps = state.employees.filter(e => e.active || recs.some(r => r.emp_id === e.id));
  const empIds = emps.map(e => e.id);
  const {hours, openFlags} = buildDayHours(recs, empIds, days);
  // payHours mirrors `hours` but rounds each punch to the nearest quarter hour first (see
  // js/rounding.js for the shop's rounding rule) — this is what Salary pays on. Report/Records
  // keep showing `hours`, the exact figure tied to the proof photo.
  const {hours: payHours} = buildDayHours(recs, empIds, days, recHoursRounded);
  const sessionsByDay = groupByEmployeeDay(recs);

  // Overrides fetched best-effort: a fresh environment that hasn't run the day_pay_overrides
  // migration yet (or a transient offline read) shouldn't break the rest of the month's data —
  // the docking feature just isn't available for this load, same fail-soft spirit as the rest
  // of this app's offline handling.
  let overrides = [];
  try{ overrides = await store.listDayPayOverrides(`${ym}-01`, `${ym}-${pad(days)}`); }catch(err){ /* see comment above */ }
  const dockedSet = new Set(overrides.filter(o => o.paid === false).map(o => `${o.emp_id}:${o.date}`));

  // reviewFlags is broader than openFlags: it also catches a day whose last session was
  // auto-closed for lunch and never got a follow-up punch — data that looks complete (real
  // hours, no open session) but hasn't actually been confirmed by the employee coming back.
  const reviewFlags = {}, reviewRecords = [];
  emps.forEach(e => { reviewFlags[e.id] = Array(days+1).fill(false); });
  Object.entries(sessionsByDay).forEach(([empId, byDay]) => {
    Object.entries(byDay).forEach(([day, sessions]) => {
      if(!needsReview(sessions)) return;
      reviewRecords.push(sessions[sessions.length - 1]);
      if(reviewFlags[empId]) reviewFlags[empId][day] = true;
    });
  });

  // gapStatus[empId][day] classifies a day with NO punches at all as 'holiday' (the standing
  // weekly holiday), 'off' (an inferred day off), or null (hasn't happened yet, or predates
  // this employee) — computed once here so the calendar pills and the employee summary's
  // days-off count can never disagree about a given day, the same way `hours` already keeps
  // Report/Records/Salary in sync.
  // dockedDays[empId][day] marks a paid-holiday Friday the owner has explicitly excluded from
  // that employee's pay this month (js/ui/report.js's day-detail panel on the 'F' pill) — kept
  // as its own parallel array, same pattern as openFlags/reviewFlags, rather than folded into
  // gapStatus's own 'holiday'/'off' classification, so a docked Friday still reads as a Friday.
  const gapStatus = {}, dockedDays = {};
  emps.forEach(e => {
    gapStatus[e.id] = Array(days+1).fill(null);
    dockedDays[e.id] = Array(days+1).fill(false);
    const since = e.created_at ? dateStr(new Date(e.created_at)) : undefined;
    for(let d=1; d<=days; d++){
      if(hours[e.id][d] !== null || openFlags[e.id][d]) continue; // has real punch data that day
      const date = `${ym}-${pad(d)}`;
      gapStatus[e.id][d] = dayOffStatus({date, weekday: new Date(y, m-1, d).getDay(), employeeSince: since});
      // Only a genuine paid-holiday gap can be docked — an override surviving from before a
      // punch was added back for this day (or before WEEKLY_HOLIDAY_DAY changed) is simply
      // ignored rather than misapplied, same defensive spirit as dayOffStatus's employeeSince gate.
      if(gapStatus[e.id][d] === 'holiday' && dockedSet.has(`${e.id}:${date}`)) dockedDays[e.id][d] = true;
    }
  });

  return {ym, days, emps, hours, payHours, openFlags, reviewFlags, gapStatus, dockedDays, sessionsByDay, recs, reviewRecords, hasData: recs.length > 0};
}

// Sums one employee's per-day hours array (as produced by monthData) into a period total.
// Shared with the Salary tab so both read the exact same hours a given month's pay is based on.
// `openArr` (monthData's openFlags[empId]) is optional — Salary doesn't need hasOpen and omits it.
export function summarizeHours(hoursArr, days, openArr = []){
  let total = 0, daysWorked = 0;
  for(let d=1; d<=days; d++){
    const v = hoursArr[d];
    if(v !== null){ total += v; daysWorked++; }
  }
  return {total, daysWorked, hasOpen: openArr.some(Boolean)};
}

export async function renderReport(){
  busy(true);
  const md = await monthData(repMonth.value);
  busy(false);
  if(!md) return;
  lastReportData = md;
  const {ym, days, emps, hours, payHours, openFlags, reviewFlags, gapStatus, dockedDays, sessionsByDay, reviewRecords, hasData} = md;
  $('repEmpty').style.display = hasData ? 'none' : '';
  $('reportMonthLabel').textContent = new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-IN', {month:'long', year:'numeric'});
  let totalHours = 0, attendanceDays = 0, absentTotal = 0, halfDayTotal = 0;
  const employeeStats = emps.map(e => {
    const {total, daysWorked, hasOpen} = summarizeHours(hours[e.id], days, reviewFlags[e.id]);
    totalHours += total;
    attendanceDays += daysWorked;
    const daysOff = gapStatus[e.id].filter(s => s === 'off').length;
    absentTotal += daysOff;
    // Same isHalfDay() call renderDetailCalendar() makes per cell, so this total can never
    // disagree with what the calendar's own yellow pills show.
    for(let d=1; d<=days; d++){
      if(isHalfDay(sessionsByDay[e.id]?.[d], hours[e.id][d])) halfDayTotal++;
    }
    return {employee:e, total, daysWorked, hasOpen, daysOff};
  });
  $('metricHours').textContent = fmtHours(totalHours);
  $('metricDays').textContent = attendanceDays;
  $('metricReview').textContent = reviewRecords.length ? `${reviewRecords.length} ${reviewRecords.length === 1 ? 'entry' : 'entries'}` : 'None';
  $('metricReview').classList.toggle('good', !reviewRecords.length);
  $('metricReview').classList.toggle('warn', !!reviewRecords.length);
  $('metricAbsent').textContent = absentTotal;
  $('metricHalfDay').textContent = halfDayTotal;
  $('reviewAlert').style.display = reviewRecords.length ? '' : 'none';
  if(reviewRecords.length){
    const nameOf = r => state.employees.find(e => e.id === r.emp_id)?.name || 'An employee';
    const openNames = [...new Set(reviewRecords.filter(r => !r.clock_out).map(nameOf))];
    const abandonedNames = [...new Set(reviewRecords.filter(r => r.clock_out).map(nameOf))];
    const parts = [];
    if(openNames.length) parts.push(`${openNames.join(', ')} ${openNames.length === 1 ? 'has' : 'have'} not clocked out yet`);
    if(abandonedNames.length) parts.push(`${abandonedNames.join(', ')} ${abandonedNames.length === 1 ? 'was' : 'were'} auto-closed for lunch and never clocked back in`);
    $('reviewTitle').textContent = `${reviewRecords.length} attendance ${reviewRecords.length === 1 ? 'entry needs' : 'entries need'} review`;
    $('reviewText').textContent = parts.join('; ') + '.';
  }
  renderDetailCalendar({ym, days, emps, hours, payHours, openFlags, reviewFlags, gapStatus, dockedDays, sessionsByDay, employeeStats});
}

// Each day is a status pill, not a number — a day can have more than one session now (a
// lunch break), which a single cell can't spell out. Employee/Days/Total-hrs columns stay
// pinned (position:sticky) so they're never the ones scrolled out of view; the day columns
// are what scrolls. Clicking a day expands an inline row with that day's actual session
// times and lunch gap, reusing the same in/out/lunch vocabulary as the Daily records tab.
function renderDetailCalendar({ym, days, emps, hours, payHours, openFlags, reviewFlags, gapStatus, dockedDays, sessionsByDay, employeeStats}){
  let h = '<tr><th class="col-emp">Employee</th>';
  for(let d=1; d<=days; d++) h += `<th>${d}</th>`;
  h += '<th class="col-days">Days</th><th class="col-absent">Absent</th><th class="col-total">Total hrs</th></tr>';
  document.querySelector('#reportTable thead').innerHTML = h;

  const tbody = document.querySelector('#reportTable tbody');
  tbody.innerHTML = '';
  employeeStats.forEach(({employee: e, total, daysWorked, hasOpen, daysOff}) => {
    const sessionsForEmp = sessionsByDay[e.id] || {};
    let halfDayCount = 0;

    const tr = document.createElement('tr');
    const empCell = document.createElement('td'); empCell.className = 'col-emp';
    const empWrap = document.createElement('div'); empWrap.className = 'emp-name';
    const avatar = document.createElement('img'); avatar.className = 'emp-avatar-img'; avatar.alt = '';
    applyAvatar(avatar, e);
    const nameWrap = document.createElement('div');
    const nameSpan = document.createElement('span'); nameSpan.textContent = e.name;
    nameWrap.appendChild(nameSpan);
    // Folded in from the old standalone Employee summary card (removed — this was the only
    // information it showed that the calendar row itself didn't already have; everything else
    // it displayed duplicated this row's own avatar/name/Days/Total-hrs columns).
    if(daysOff > 0){
      const offBadge = document.createElement('div'); offBadge.className = 'report-daysoff';
      offBadge.textContent = `● ${daysOff} ${daysOff === 1 ? 'day off' : 'days off'}`;
      nameWrap.appendChild(offBadge);
    }
    if(hasOpen){
      const stateEl = document.createElement('div'); stateEl.className = 'report-state open';
      stateEl.textContent = '● Review required';
      nameWrap.appendChild(stateEl);
    }
    empWrap.append(avatar, nameWrap);
    empCell.appendChild(empWrap);
    tr.appendChild(empCell);
    tr._empId = e.id; // lets the reopen-after-save pass below find this row again post-rebuild

    for(let d=1; d<=days; d++){
      const sessions = sessionsForEmp[d];
      const open = openFlags[e.id][d];
      const hasHours = hours[e.id][d] !== null;
      // "flagged" = needs review but isn't genuinely still open — i.e. the day's last session
      // was auto-closed for lunch and never got a follow-up punch. Hours ARE known (hasHours),
      // so this shows the day number with an amber marker, not the '!' used for a truly open
      // session (where there's no final number to show yet).
      const flagged = reviewFlags[e.id][d] && !open;
      // An auto-close that DID get resumed afterward is worth a quiet, informational note (blue)
      // — distinct from one that never resolved (amber, via `flagged` above).
      const autoInfo = !flagged && sessions && sessions.some(s => s.clock_out && !s.out_photo);
      // Only reached with no punches at all (not open, no hours) — 'holiday' or 'off', see
      // dayOffStatus() in reportMath.js for what decides which, or null for nothing to show.
      const gap = !open && !hasHours ? gapStatus[e.id][d] : null;
      // A single-session day with notably fewer hours than a full day (only a morning or only
      // an afternoon punch) gets its own color — a single session with close to a full day's
      // hours (worked straight through, no break) stays 'full'. See isHalfDay() in reportMath.js.
      const half = hasHours && isHalfDay(sessions, hours[e.id][d]);
      if(half) halfDayCount++;
      // A single session that IS a full day's hours has no recorded lunch gap either — could be
      // a genuine no-break shift, or a forgotten lunch punch; punch data alone can't tell which,
      // so this is a quiet corner-dot nudge (not the amber "needs review" treatment), same visual
      // language as .auto below. See isPossibleMissedLunch() in reportMath.js.
      const unbroken = hasHours && !half && isPossibleMissedLunch(sessions, hours[e.id][d]);
      // A Friday the owner has explicitly excluded from this employee's pay this month — see
      // the day-detail panel opened by clicking the pill below. Still reads as 'holiday' (the
      // day itself didn't stop being a Friday), just with the same quiet corner-dot treatment
      // .auto/.flagged/.unbroken already use for "worth noticing" states on top of a base pill.
      const docked = gap === 'holiday' && dockedDays[e.id][d];
      const pill = document.createElement('div');
      pill.className = 'daypill' + (open ? ' review' : hasHours ? (half ? ' half' : ' full') : gap ? ` ${gap}` : '')
        + (flagged ? ' flagged' : '') + (autoInfo ? ' auto' : '') + (unbroken ? ' unbroken' : '') + (docked ? ' docked' : '')
        + (hasHours && !open ? ' has-hours' : '');
      // The column header above already carries the day-of-month, so the pill itself shows the
      // one thing that header can't: this day's hours, at a glance, with no click needed (the
      // owner's ask, 2026-09-12). Shows PAID hours (payHours, the same grace-window-rounded
      // figure Salary pays on — js/rounding.js) rather than the exact punch-to-punch figure
      // (2026-09-12, superseding this file's earlier "Report always shows exact times" rule —
      // see the Payroll rounding section in CLAUDE.md, updated to match). Exact hours (`hours`)
      // still drive which STATE a day is in (half/full/unbroken all classify off real attendance,
      // not pay) — only the number printed in the pill changed; the day-detail panel below and
      // Daily records keep the exact audit-trail times.
      pill.textContent = open ? '!' : hasHours ? fmtHours(payHours[e.id][d]) : gap === 'holiday' ? 'F' : gap === 'off' ? 'A' : '';
      if(unbroken) pill.title = 'Single session, no recorded break — check whether a lunch punch was missed';
      else if(docked) pill.title = 'Marked unpaid for this employee — click to restore';
      else if(hasHours) pill.title = `Day ${d} — ${fmtHours(payHours[e.id][d])} paid, click for session detail`;
      else if(gap === 'off') pill.title = 'Absent — click to add a missed punch';
      if(sessions){
        pill.onclick = () => toggleDayDetail(tr, sessions, e, d, ym);
      }else if(gap === 'holiday'){
        // No punches to show for a holiday day, but it's still the one place a per-day
        // correction belongs (same "click the pill" convention as every other day type) —
        // toggleDayDetail dispatches to renderHolidayDetail when there's no sessions array.
        pill.onclick = () => toggleDayDetail(tr, null, e, d, ym, docked);
      }else if(gap === 'off'){
        // The owner's ask (2026-09-12): an absence is sometimes actually a missed punch (kiosk
        // down, forgot to tap), not a real no-show — let the admin backfill it right from the
        // pill. Deliberately NOT wired for a blank "no record" pill (gap === null): that state
        // only ever means a future date or a day before this employee was hired (see
        // dayOffStatus() in reportMath.js) — exactly the cases that should stay locked, so
        // there's nothing to add there without a separate, explicit backdating decision.
        pill.onclick = () => addMissedPunch(e, `${ym}-${pad(d)}`, renderReport);
      }
      const cell = document.createElement('td'); cell.className = 'day-cell';
      cell.appendChild(pill);
      tr.appendChild(cell);
    }

    // Absent days = full absences (gapStatus 'off') plus a half-credit per half day — the
    // owner's own definition (2026-09-12: "total absent days ... .5 for half days"), not a new
    // classification of its own, so it can never disagree with the daysOff badge above or the
    // pills' own colors: same daysOff and halfDayCount this row already computed either way.
    const absentDaysEq = daysOff + halfDayCount * 0.5;
    const daysCell = document.createElement('td'); daysCell.className = 'col-days';
    daysCell.innerHTML = `<span>Days</span>${daysWorked}`;
    const absentCell = document.createElement('td'); absentCell.className = 'col-absent';
    absentCell.innerHTML = `<span>Absent</span>${absentDaysEq % 1 === 0 ? absentDaysEq : absentDaysEq.toFixed(1)}`;
    if(absentDaysEq > 0){
      absentCell.classList.add('clickable');
      absentCell.title = 'Click for the exact dates';
      absentCell.onclick = () => showAbsenceDetail(e, ym, days, gapStatus[e.id], hours[e.id], sessionsForEmp);
    }
    const totalCell = document.createElement('td'); totalCell.className = 'col-total';
    totalCell.innerHTML = `<span>Total</span>${fmtHours(total)}`;
    tr.append(daysCell, absentCell, totalCell);
    tbody.appendChild(tr);

    const detailRow = document.createElement('tr'); detailRow.className = 'detail-row';
    const detailCell = document.createElement('td'); detailCell.colSpan = days + 3;
    const detailInner = document.createElement('div'); detailInner.className = 'detail-inner';
    detailCell.appendChild(detailInner);
    detailRow.appendChild(detailCell);
    tbody.appendChild(detailRow);
    tr._detailRow = detailRow;
    tr._detailInner = detailInner;
  });

  // An inline edit/delete/split/lunch-toggle from the detail panel below calls renderReport(),
  // which rebuilds this whole table from scratch — without this, saving a change would silently
  // close the very panel the admin is looking at. Only reopens if that day still has sessions
  // (e.g. wasn't the one just-deleted record) and still belongs to a row on this page.
  if(openDetailKey){
    const [empId, dayStr] = openDetailKey.split(':');
    const day = Number(dayStr);
    const matchTr = Array.from(tbody.children).find(t => t._empId === empId);
    const sessions = (sessionsByDay[empId] || {})[day];
    const emp = employeeStats.find(s => s.employee.id === empId)?.employee;
    if(matchTr && emp && sessions && sessions.length){
      renderDayDetail(matchTr._detailRow, matchTr._detailInner, sessions, emp, day);
    }else if(matchTr && emp && gapStatus[empId][day] === 'holiday'){
      renderHolidayDetail(matchTr._detailRow, matchTr._detailInner, emp, ym, day, dockedDays[empId][day]);
    }else{
      openDetailKey = null;
    }
  }
}

// The "Absent" column shows a single combined number (full absences + half-credits) — the
// owner asked for the actual dates behind it, since a bare "5.5" doesn't say which days those
// were (2026-09-12). Recomputes fullDays/halfDays directly from the same gapStatus/isHalfDay
// classification the calendar pills already use, rather than threading a second array through
// from render time, so this can never disagree with what the pills themselves show.
function showAbsenceDetail(emp, ym, days, gapArr, hoursArr, sessionsForEmp){
  const fullDays = [], halfDays = [];
  for(let d = 1; d <= days; d++){
    if(gapArr[d] === 'off') fullDays.push(d);
    else if(hoursArr[d] != null && isHalfDay(sessionsForEmp[d], hoursArr[d])) halfDays.push(d);
  }
  const fmtDate = d => new Date(`${ym}-${pad(d)}T12:00:00`).toLocaleDateString('en-IN', {weekday:'short', month:'short', day:'numeric'});
  const section = (label, dayList, cls) => {
    const wrap = document.createElement('div'); wrap.className = 'absence-section';
    const h = document.createElement('h3'); h.className = `absence-heading ${cls}`;
    h.textContent = `${label} (${dayList.length})`;
    wrap.appendChild(h);
    if(!dayList.length){
      const p = document.createElement('p'); p.className = 'absence-empty'; p.textContent = 'None this month';
      wrap.appendChild(p);
    }else{
      const ul = document.createElement('ul'); ul.className = 'absence-list';
      dayList.forEach(d => { const li = document.createElement('li'); li.textContent = fmtDate(d); ul.appendChild(li); });
      wrap.appendChild(ul);
    }
    return wrap;
  };
  infoModal({
    title: `${emp.name} — absences this month`,
    render(container){
      const body = document.createElement('div'); body.className = 'absence-modal-body';
      body.append(section('Full absent days', fullDays, 'full'), section('Half days', halfDays, 'half'));
      container.appendChild(body);
    }
  });
}

// A small "paid 9:15" annotation appended after a punch time, shown only when rounding
// actually moved that punch — this is the "if they challenge it" evidence: the exact punch
// stays visible, with what it was rounded to for pay right next to it.
function paidNote(iso){
  return wasRounded(iso) ? ` <span class="paid-note">&rarr; ${fmtTime(roundToQuarterHour(iso))} paid</span>` : '';
}

// Toggles the row's detail panel: closes if the same day's pill is clicked again, otherwise
// (re)builds it. emp/day identify this panel for openDetailKey so a save made inside it can find
// its way back open after the table rebuilds. `sessions` is null for a no-punch holiday day —
// there's nothing to show but the day itself, so it renders through renderHolidayDetail instead.
function toggleDayDetail(tr, sessions, emp, day, ym, docked){
  const row = tr._detailRow;
  const key = `${emp.id}:${day}`;
  if(row.classList.contains('open') && row._key === key){
    row.classList.remove('open');
    openDetailKey = null;
    return;
  }
  openDetailKey = key;
  if(sessions) renderDayDetail(row, tr._detailInner, sessions, emp, day);
  else renderHolidayDetail(row, tr._detailInner, emp, ym, day, docked);
}

// The day-detail panel for a paid-holiday Friday with no punches at all — there's no session to
// show, just the one correction available for this day type: excluding it from this employee's
// pay for a month they've taken more time off than the standing holiday allowance covers. Same
// reversible, no-confirm toggle shape as the lunch-paid chip above (a mistaken tap costs one
// more tap, not a dialog) — store.setDayOverride() is the write path, mirroring toggleLunchPaid.
function renderHolidayDetail(row, inner, emp, ym, day, docked){
  inner.innerHTML = '';
  const dateOnly = `${ym}-${pad(day)}`;
  const dateLabel = document.createElement('span'); dateLabel.className = 'detail-date';
  dateLabel.textContent = new Date(dateOnly + 'T00:00:00').toLocaleDateString('en-IN', {month:'short', day:'numeric'});
  inner.appendChild(dateLabel);

  const line = document.createElement('div'); line.className = 'detail-row-line';
  const chip = document.createElement('span'); chip.className = 'chip' + (docked ? ' review' : '');
  chip.textContent = docked ? 'Paid holiday — marked unpaid this month' : 'Paid holiday (Friday) — no punches expected';
  const toggle = document.createElement('button');
  toggle.className = 'btn small ghost';
  toggle.textContent = docked ? 'Restore as paid' : 'Mark unpaid';
  toggle.title = docked ? `Pay ${emp.name} for this Friday as usual` : `Exclude this Friday from ${emp.name}'s pay this month`;
  toggle.onclick = () => toggleHolidayPay(emp.id, dateOnly, docked);
  line.append(chip, toggle);
  inner.appendChild(line);

  row._key = `${emp.id}:${day}`;
  row.classList.add('open');
}

async function toggleHolidayPay(empId, dateOnly, currentlyDocked){
  busy(true);
  try{
    await store.setDayOverride(empId, dateOnly, currentlyDocked); // flip: paid = currently-docked
    await renderReport();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// Builds the day-detail panel's contents — same in/out/lunch chip vocabulary as Daily records,
// but now actionable in place (Phase 2 of the holiday/day-off visibility work: "make the
// monthly view's corrections actionable instead of read-only"): edit or delete any session,
// toggle a lunch gap paid, or split a single straight-through session — all via the exact same
// store-backed flows Daily records itself uses (js/ui/records.js), so there's exactly one
// implementation of each to ever disagree with itself. Every action's `afterSave` is
// renderReport() (recomputes the whole month, not just this row) rather than Daily records'
// default of re-rendering itself, since an edit here can change another day's totals too (e.g.
// a lunch-paid toggle) and this panel doesn't have its own copy of that data to patch in place.
function renderDayDetail(row, inner, sessions, emp, day){
  const afterSave = renderReport;
  inner.innerHTML = '';
  const dateLabel = document.createElement('span'); dateLabel.className = 'detail-date';
  dateLabel.textContent = new Date(sessions[0].date + 'T00:00:00').toLocaleDateString('en-IN', {month:'short', day:'numeric'});
  inner.appendChild(dateLabel);
  // Same "only one gap is actually lunch" fix as records.js's lunchDivider() — with 3+ sessions
  // (2+ gaps), every gap used to render as "Lunch", which misreads as multiple lunch breaks in
  // one day. See lunchGapIndex() in reportMath.js.
  // Each session (and the lunch/break gap before it) is its own row — previously every chip and
  // button across the whole day was appended as siblings into one flex-wrap container, which
  // wrapped wherever it ran out of width rather than at session boundaries, so a 2-session day
  // could wrap into two visually misaligned lines with no relation to which chips belonged to
  // which session. Grouping per row means the browser only ever wraps a whole row at once.
  const lunchIdx = lunchGapIndex(sessions);
  sessions.forEach((s, i) => {
    if(i > 0){
      const gapSession = sessions[i-1];
      const gapHours = (new Date(s.clock_in) - new Date(gapSession.clock_out)) / 3600000;
      const auto = !gapSession.out_photo;
      const paid = gapSession.lunch_paid;
      const kind = i === lunchIdx ? 'Lunch' : 'Break';
      const lunchRow = document.createElement('div'); lunchRow.className = 'detail-row-line';
      const lunchChip = document.createElement('span'); lunchChip.className = 'chip lunch';
      lunchChip.textContent = `${kind} ${fmtHours(gapHours)}${auto ? ' (auto)' : ''}${paid ? ' — paid as work' : ''}`;
      const bLunch = document.createElement('button');
      bLunch.className = 'btn small ghost';
      bLunch.textContent = paid ? 'Undo' : 'Pay this';
      bLunch.title = paid ? `Stop paying through this ${kind.toLowerCase()} gap` : `Include this ${kind.toLowerCase()} gap as paid work`;
      bLunch.onclick = () => toggleLunchPaid(gapSession, afterSave);
      lunchRow.append(lunchChip, bLunch);
      inner.appendChild(lunchRow);
    }
    const sessionRow = document.createElement('div'); sessionRow.className = 'detail-row-line';
    const inChip = document.createElement('span'); inChip.className = 'chip';
    inChip.innerHTML = `<span class="lbl">In</span>${fmtTime(s.clock_in)}${paidNote(s.clock_in)}`;
    const outChip = document.createElement('span'); outChip.className = 'chip' + (s.clock_out ? '' : ' review');
    outChip.innerHTML = `<span class="lbl">Out</span>${s.clock_out ? fmtTime(s.clock_out) + paidNote(s.clock_out) : 'Still in'}`;
    const bEdit = document.createElement('button');
    bEdit.className = 'btn small ghost'; bEdit.textContent = 'Edit';
    bEdit.onclick = () => editRecord(s, emp, afterSave);
    const bDelete = document.createElement('button');
    bDelete.className = 'btn small red'; bDelete.textContent = 'Delete';
    bDelete.onclick = () => deleteRecordFlow(s, emp, afterSave);
    // Edit/Delete/Split travel together in their own non-wrapping cluster (same
    // punches/actions split Daily records uses in js/ui/records.js's sessionContent()) — without
    // it, a narrow panel could wrap mid-cluster and strand Delete alone on its own line, which is
    // what actually happened before this and read as broken alignment, not a graceful wrap.
    const actions = document.createElement('div'); actions.className = 'detail-actions';
    actions.append(bEdit, bDelete);
    // Same "closed single session" gate as Daily records' own Split for lunch button — a day
    // with more than one session already has its lunch break punched, nothing to split.
    if(sessions.length === 1 && s.clock_out){
      const bSplit = document.createElement('button');
      bSplit.className = 'btn small ghost'; bSplit.textContent = 'Split for lunch';
      bSplit.title = 'The new lunch gap is unpaid by default — use "Pay this" after if it should be paid';
      bSplit.onclick = () => splitForLunch(s, emp, afterSave);
      actions.appendChild(bSplit);
    }
    sessionRow.append(inChip, outChip, actions);
    inner.appendChild(sessionRow);
  });

  const totalHours = dayHoursFromSessions(sessions, recHours).total || 0;
  const totalPaidHours = dayHoursFromSessions(sessions, recHoursRounded).total || 0;
  const stillOpen = sessions.some(s => !s.clock_out);
  // A distinct footer row, separated by a divider line: the total is passive information, the
  // jump button is the one action that leaves this panel for something it can't do (viewing the
  // punch photos, still Daily-records-only — see CLAUDE.md) — `justify-content:space-between`
  // pins it to the far edge instead of trailing wherever the last chip happened to end, which is
  // what made it easy to miss as a plain icon crammed onto the end of a wrapped chip line before.
  const footer = document.createElement('div'); footer.className = 'detail-footer';
  const totalSpan = document.createElement('span'); totalSpan.className = 'detail-total';
  totalSpan.innerHTML = `Worked <b>${fmtHours(totalHours)}</b>${stillOpen ? ' so far' : ''}`
    + (!stillOpen && totalPaidHours !== totalHours ? ` &middot; Paid <b>${fmtHours(totalPaidHours)}</b>` : '');
  const jumpBtn = document.createElement('button');
  jumpBtn.className = 'btn small detail-jump';
  jumpBtn.innerHTML = 'Open in Daily records <span aria-hidden="true">&rarr;</span>';
  jumpBtn.onclick = () => {
    setRecordsDate(sessions[0].date);
    switchTab('records');
  };
  footer.append(totalSpan, jumpBtn);
  inner.appendChild(footer);

  row._key = `${emp.id}:${day}`;
  row.classList.add('open');
}

// A click anywhere outside an open detail row — and outside the pill that opens one, the shared
// prompt modal an inline action opens, or the review-alert's own button — closes it. The modal
// exclusion matters: without it, clicking that modal's own Save button (which lives outside
// `.detail-row` in the DOM) would bubble up and close/reset this panel a tick before the save's
// own afterSave callback gets a chance to reopen it, so the panel would appear to close itself
// on every edit. Same problem, same fix, for #btnReviewRecords: it opens a panel from OUTSIDE
// the calendar, so without this exclusion this same listener would close it back immediately,
// in the very click that opened it.
document.addEventListener('click', e => {
  if(e.target.closest('.daypill') || e.target.closest('.detail-row') || e.target.closest('#promptModal') || e.target.closest('#btnReviewRecords')) return;
  document.querySelectorAll('.detail-row.open').forEach(row => row.classList.remove('open'));
  openDetailKey = null;
});

$('btnExport').onclick = async () => {
  busy(true);
  const md = await monthData(repMonth.value);
  busy(false);
  if(!md) return;
  const {ym, days, emps, hours, openFlags} = md;
  const header = ['Employee', ...Array.from({length:days}, (_,i) => `${ym}-${pad(i+1)}`), 'Days worked', 'Total hours'];
  const rows = emps.map(e => {
    let total = 0, daysWorked = 0;
    const cells = [];
    for(let d=1; d<=days; d++){
      const v = hours[e.id][d];
      // See the same accumulation-vs-display split in renderReport()'s calendar loop above.
      if(v !== null){ total += v; daysWorked++; }
      if(openFlags[e.id][d]) cells.push('IN (no out)');
      else if(v === null) cells.push('');
      else cells.push(Number(v.toFixed(2)));
    }
    return [e.name, ...cells, daysWorked, Number(total.toFixed(2))];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{wch:18}, ...Array(days).fill({wch:10}), {wch:11}, {wch:11}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ym);
  XLSX.writeFile(wb, `attendance-${ym}.xlsx`);
};
