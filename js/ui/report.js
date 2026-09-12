import { $, busy, toast, pad, fmtHours, fmtTime, recHours, dateStr, shiftMonthInput } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { switchTab } from './shell.js';
import { setRecordsDate, editRecord, deleteRecordFlow, toggleLunchPaid, splitForLunch } from './records.js';
import { buildDayHours, groupByEmployeeDay, needsReview, dayHoursFromSessions, dayOffStatus, isHalfDay, lunchGapIndex } from '../reportMath.js';
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
$('btnReportDetail').onclick = () => {
  const detail = $('reportDetail');
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : '';
  $('btnReportDetail').textContent = isOpen ? 'View detailed calendar' : 'Hide detailed calendar';
};
$('btnReviewRecords').onclick = () => {
  const first = lastReportData?.reviewRecords?.[0];
  if(first) setRecordsDate(first.date);
  switchTab('records');
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
  const gapStatus = {};
  emps.forEach(e => {
    gapStatus[e.id] = Array(days+1).fill(null);
    const since = e.created_at ? dateStr(new Date(e.created_at)) : undefined;
    for(let d=1; d<=days; d++){
      if(hours[e.id][d] !== null || openFlags[e.id][d]) continue; // has real punch data that day
      gapStatus[e.id][d] = dayOffStatus({
        date: `${ym}-${pad(d)}`,
        weekday: new Date(y, m-1, d).getDay(),
        employeeSince: since
      });
    }
  });

  return {ym, days, emps, hours, payHours, openFlags, reviewFlags, gapStatus, sessionsByDay, recs, reviewRecords, hasData: recs.length > 0};
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
  const {ym, days, emps, hours, openFlags, reviewFlags, gapStatus, sessionsByDay, reviewRecords, hasData} = md;
  $('repEmpty').style.display = hasData ? 'none' : '';
  $('reportMonthLabel').textContent = new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-IN', {month:'long', year:'numeric'});
  let totalHours = 0, attendanceDays = 0;
  const employeeStats = emps.map(e => {
    const {total, daysWorked, hasOpen} = summarizeHours(hours[e.id], days, reviewFlags[e.id]);
    totalHours += total;
    attendanceDays += daysWorked;
    const daysOff = gapStatus[e.id].filter(s => s === 'off').length;
    return {employee:e, total, daysWorked, hasOpen, daysOff};
  });
  $('metricHours').textContent = fmtHours(totalHours);
  $('metricDays').textContent = attendanceDays;
  $('metricReview').textContent = reviewRecords.length ? `${reviewRecords.length} ${reviewRecords.length === 1 ? 'entry' : 'entries'}` : 'None';
  $('metricReview').classList.toggle('good', !reviewRecords.length);
  $('metricReview').classList.toggle('warn', !!reviewRecords.length);
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
  const list = $('reportEmployeeList');
  list.innerHTML = '';
  employeeStats.forEach(({employee, total, daysWorked, hasOpen, daysOff}) => {
    const row = document.createElement('div');
    row.className = 'report-person';
    const avatar = document.createElement('img');
    avatar.className = 'report-avatar'; avatar.alt = '';
    applyAvatar(avatar, employee);
    const who = document.createElement('div');
    const name = document.createElement('div'); name.className = 'report-name'; name.textContent = employee.name;
    const days = document.createElement('span'); days.className = 'report-detail report-days-inline'; days.textContent = `${daysWorked} ${daysWorked === 1 ? 'attendance day' : 'attendance days'}`;
    who.append(name, days);
    if(daysOff > 0){
      // Always visible (not the mobile-only pattern .report-days-inline uses above) — this is
      // the "very clearly" surface for a day off, since the calendar pill alone is small.
      const offBadge = document.createElement('div'); offBadge.className = 'report-daysoff';
      offBadge.textContent = `● ${daysOff} ${daysOff === 1 ? 'day off' : 'days off'}`;
      who.appendChild(offBadge);
    }
    const stateEl = document.createElement('div'); stateEl.className = `report-state ${hasOpen ? 'open' : 'ok'}`; stateEl.textContent = hasOpen ? '● Review required' : '● All clear';
    const daysNumber = document.createElement('div'); daysNumber.className = 'report-number days-worked'; daysNumber.innerHTML = `<span>Days</span><strong>${daysWorked}</strong>`;
    const hoursNumber = document.createElement('div'); hoursNumber.className = 'report-number'; hoursNumber.innerHTML = `<span>Total hours</span><strong>${fmtHours(total)}</strong>`;
    row.append(avatar, who, stateEl, daysNumber, hoursNumber);
    list.appendChild(row);
  });

  renderDetailCalendar({days, emps, hours, openFlags, reviewFlags, gapStatus, sessionsByDay, employeeStats});
}

// Each day is a status pill, not a number — a day can have more than one session now (a
// lunch break), which a single cell can't spell out. Employee/Days/Total-hrs columns stay
// pinned (position:sticky) so they're never the ones scrolled out of view; the day columns
// are what scrolls. Clicking a day expands an inline row with that day's actual session
// times and lunch gap, reusing the same in/out/lunch vocabulary as the Daily records tab.
function renderDetailCalendar({days, emps, hours, openFlags, reviewFlags, gapStatus, sessionsByDay, employeeStats}){
  let h = '<tr><th class="col-emp">Employee</th>';
  for(let d=1; d<=days; d++) h += `<th>${d}</th>`;
  h += '<th class="col-days">Days</th><th class="col-total">Total hrs</th></tr>';
  document.querySelector('#reportTable thead').innerHTML = h;

  const tbody = document.querySelector('#reportTable tbody');
  tbody.innerHTML = '';
  employeeStats.forEach(({employee: e, total, daysWorked}) => {
    const sessionsForEmp = sessionsByDay[e.id] || {};

    const tr = document.createElement('tr');
    const empCell = document.createElement('td'); empCell.className = 'col-emp';
    const empWrap = document.createElement('div'); empWrap.className = 'emp-name';
    const avatar = document.createElement('img'); avatar.className = 'emp-avatar-img'; avatar.alt = '';
    applyAvatar(avatar, e);
    const nameSpan = document.createElement('span'); nameSpan.textContent = e.name;
    empWrap.append(avatar, nameSpan);
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
      const pill = document.createElement('div');
      pill.className = 'daypill' + (open ? ' review' : hasHours ? (half ? ' half' : ' full') : gap ? ` ${gap}` : '')
        + (flagged ? ' flagged' : '') + (autoInfo ? ' auto' : '');
      pill.textContent = open ? '!' : hasHours ? d : gap === 'holiday' ? 'F' : gap === 'off' ? 'A' : '';
      if(sessions){
        pill.onclick = () => toggleDayDetail(tr, sessions, e, d);
      }
      const cell = document.createElement('td'); cell.className = 'day-cell';
      cell.appendChild(pill);
      tr.appendChild(cell);
    }

    const daysCell = document.createElement('td'); daysCell.className = 'col-days';
    daysCell.innerHTML = `<span>Days</span>${daysWorked}`;
    const totalCell = document.createElement('td'); totalCell.className = 'col-total';
    totalCell.innerHTML = `<span>Total</span>${fmtHours(total)}`;
    tr.append(daysCell, totalCell);
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
    if(matchTr && sessions && sessions.length){
      const emp = employeeStats.find(s => s.employee.id === empId)?.employee;
      renderDayDetail(matchTr._detailRow, matchTr._detailInner, sessions, emp, day);
    }else{
      openDetailKey = null;
    }
  }
}

// A small "paid 9:15" annotation appended after a punch time, shown only when rounding
// actually moved that punch — this is the "if they challenge it" evidence: the exact punch
// stays visible, with what it was rounded to for pay right next to it.
function paidNote(iso){
  return wasRounded(iso) ? ` <span class="paid-note">&rarr; ${fmtTime(roundToQuarterHour(iso))} paid</span>` : '';
}

// Toggles the row's detail panel: closes if the same day's pill is clicked again, otherwise
// (re)builds it from that day's sessions. emp/day identify this panel for openDetailKey so a
// save made inside it (see renderDayDetail) can find its way back open after the table rebuilds.
function toggleDayDetail(tr, sessions, emp, day){
  const row = tr._detailRow;
  const key = `${emp.id}:${day}`;
  if(row.classList.contains('open') && row._key === key){
    row.classList.remove('open');
    openDetailKey = null;
    return;
  }
  openDetailKey = key;
  renderDayDetail(row, tr._detailInner, sessions, emp, day);
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
  const lunchIdx = lunchGapIndex(sessions);
  sessions.forEach((s, i) => {
    if(i > 0){
      const gapSession = sessions[i-1];
      const gapHours = (new Date(s.clock_in) - new Date(gapSession.clock_out)) / 3600000;
      const auto = !gapSession.out_photo;
      const paid = gapSession.lunch_paid;
      const kind = i === lunchIdx ? 'Lunch' : 'Break';
      const lunchChip = document.createElement('span'); lunchChip.className = 'chip lunch';
      lunchChip.textContent = `${kind} ${fmtHours(gapHours)}${auto ? ' (auto)' : ''}${paid ? ' — paid as work' : ''}`;
      inner.appendChild(lunchChip);
      const bLunch = document.createElement('button');
      bLunch.className = 'btn small ghost';
      bLunch.textContent = paid ? 'Undo' : 'Pay this';
      bLunch.title = paid ? `Stop paying through this ${kind.toLowerCase()} gap` : `Include this ${kind.toLowerCase()} gap as paid work`;
      bLunch.onclick = () => toggleLunchPaid(gapSession, afterSave);
      inner.appendChild(bLunch);
    }
    const inChip = document.createElement('span'); inChip.className = 'chip';
    inChip.innerHTML = `<span class="lbl">In</span>${fmtTime(s.clock_in)}${paidNote(s.clock_in)}`;
    inner.appendChild(inChip);
    const outChip = document.createElement('span'); outChip.className = 'chip' + (s.clock_out ? '' : ' review');
    outChip.innerHTML = `<span class="lbl">Out</span>${s.clock_out ? fmtTime(s.clock_out) + paidNote(s.clock_out) : 'Still in'}`;
    inner.appendChild(outChip);
    const bEdit = document.createElement('button');
    bEdit.className = 'btn small ghost'; bEdit.textContent = 'Edit';
    bEdit.onclick = () => editRecord(s, emp, afterSave);
    inner.appendChild(bEdit);
    const bDelete = document.createElement('button');
    bDelete.className = 'btn small red'; bDelete.textContent = 'Delete';
    bDelete.onclick = () => deleteRecordFlow(s, emp, afterSave);
    inner.appendChild(bDelete);
    // Same "closed single session" gate as Daily records' own Split for lunch button — a day
    // with more than one session already has its lunch break punched, nothing to split.
    if(sessions.length === 1 && s.clock_out){
      const bSplit = document.createElement('button');
      bSplit.className = 'btn small ghost'; bSplit.textContent = 'Split for lunch';
      bSplit.onclick = () => splitForLunch(s, emp, afterSave);
      inner.appendChild(bSplit);
    }
  });
  const totalHours = dayHoursFromSessions(sessions, recHours).total || 0;
  const totalPaidHours = dayHoursFromSessions(sessions, recHoursRounded).total || 0;
  const stillOpen = sessions.some(s => !s.clock_out);
  const totalSpan = document.createElement('span'); totalSpan.className = 'detail-total';
  totalSpan.innerHTML = `Worked <b>${fmtHours(totalHours)}</b>${stillOpen ? ' so far' : ''}`
    + (!stillOpen && totalPaidHours !== totalHours ? ` &middot; Paid <b>${fmtHours(totalPaidHours)}</b>` : '');
  inner.appendChild(totalSpan);
  // Kept alongside the new inline actions above — still useful for anything this panel doesn't
  // cover (viewing the punch photos, for one, which stays Daily-records-only — see CLAUDE.md).
  const jumpBtn = document.createElement('button');
  jumpBtn.className = 'btn small ghost detail-jump';
  jumpBtn.textContent = '↗';
  jumpBtn.title = 'Open in Daily records';
  jumpBtn.setAttribute('aria-label', 'Open in Daily records');
  jumpBtn.onclick = () => {
    setRecordsDate(sessions[0].date);
    switchTab('records');
  };
  inner.appendChild(jumpBtn);
  row._key = `${emp.id}:${day}`;
  row.classList.add('open');
}

// A click anywhere outside an open detail row — and outside the pill that opens one, or the
// shared prompt modal an inline action opens — closes it. The modal exclusion matters: without
// it, clicking that modal's own Save button (which lives outside `.detail-row` in the DOM)
// would bubble up and close/reset this panel a tick before the save's own afterSave callback
// gets a chance to reopen it, so the panel would appear to close itself on every edit.
document.addEventListener('click', e => {
  if(e.target.closest('.daypill') || e.target.closest('.detail-row') || e.target.closest('#promptModal')) return;
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
