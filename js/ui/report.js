import { $, busy, toast, pad, fmtHours, fmtTime, recHours, dateStr, shiftMonthInput } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { switchTab } from './shell.js';
import { setRecordsDate } from './records.js';
import { buildDayHours, groupByEmployeeDay } from '../reportMath.js';

const repMonth = $('repMonth');
repMonth.value = dateStr().slice(0,7);
repMonth.onchange = renderReport;
let lastReportData = null;

$('btnPrevMonth').onclick = () => shiftMonthInput(repMonth, -1, renderReport);
$('btnNextMonth').onclick = () => shiftMonthInput(repMonth, 1, renderReport);
$('btnReportDetail').onclick = () => {
  const detail = $('reportDetail');
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : '';
  $('btnReportDetail').textContent = isOpen ? 'View detailed calendar' : 'Hide detailed calendar';
};
$('btnReviewRecords').onclick = () => {
  const first = lastReportData?.openRecords?.[0];
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
  const {hours, openFlags} = buildDayHours(recs, emps.map(e => e.id), days);
  const sessionsByDay = groupByEmployeeDay(recs);
  return {ym, days, emps, hours, openFlags, sessionsByDay, recs, openRecords:recs.filter(r => !r.clock_out), hasData: recs.length > 0};
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
  const {ym, days, emps, hours, openFlags, sessionsByDay, openRecords, hasData} = md;
  $('repEmpty').style.display = hasData ? 'none' : '';
  $('reportMonthLabel').textContent = new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-IN', {month:'long', year:'numeric'});
  let totalHours = 0, attendanceDays = 0;
  const employeeStats = emps.map(e => {
    const {total, daysWorked, hasOpen} = summarizeHours(hours[e.id], days, openFlags[e.id]);
    totalHours += total;
    attendanceDays += daysWorked;
    return {employee:e, total, daysWorked, hasOpen};
  });
  $('metricHours').textContent = fmtHours(totalHours);
  $('metricDays').textContent = attendanceDays;
  $('metricReview').textContent = openRecords.length ? `${openRecords.length} ${openRecords.length === 1 ? 'entry' : 'entries'}` : 'None';
  $('metricReview').classList.toggle('good', !openRecords.length);
  $('metricReview').classList.toggle('warn', !!openRecords.length);
  $('reviewAlert').style.display = openRecords.length ? '' : 'none';
  if(openRecords.length){
    const names = [...new Set(openRecords.map(r => state.employees.find(e => e.id === r.emp_id)?.name || 'An employee'))];
    $('reviewTitle').textContent = `${openRecords.length} attendance ${openRecords.length === 1 ? 'entry needs' : 'entries need'} review`;
    $('reviewText').textContent = `${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} not clocked out yet.`;
  }
  const list = $('reportEmployeeList');
  list.innerHTML = '';
  employeeStats.forEach(({employee, total, daysWorked, hasOpen}) => {
    const row = document.createElement('div');
    row.className = 'report-person';
    const avatar = document.createElement('img');
    avatar.className = 'report-avatar'; avatar.alt = '';
    applyAvatar(avatar, employee);
    const who = document.createElement('div');
    const name = document.createElement('div'); name.className = 'report-name'; name.textContent = employee.name;
    const days = document.createElement('span'); days.className = 'report-detail report-days-inline'; days.textContent = `${daysWorked} ${daysWorked === 1 ? 'attendance day' : 'attendance days'}`;
    who.append(name, days);
    const stateEl = document.createElement('div'); stateEl.className = `report-state ${hasOpen ? 'open' : 'ok'}`; stateEl.textContent = hasOpen ? '● Review required' : '● All clear';
    const daysNumber = document.createElement('div'); daysNumber.className = 'report-number days-worked'; daysNumber.innerHTML = `<span>Days</span><strong>${daysWorked}</strong>`;
    const hoursNumber = document.createElement('div'); hoursNumber.className = 'report-number'; hoursNumber.innerHTML = `<span>Total hours</span><strong>${fmtHours(total)}</strong>`;
    row.append(avatar, who, stateEl, daysNumber, hoursNumber);
    list.appendChild(row);
  });

  renderDetailCalendar({days, emps, hours, openFlags, sessionsByDay, employeeStats});
}

// Each day is a status pill, not a number — a day can have more than one session now (a
// lunch break), which a single cell can't spell out. Employee/Days/Total-hrs columns stay
// pinned (position:sticky) so they're never the ones scrolled out of view; the day columns
// are what scrolls. Clicking a day expands an inline row with that day's actual session
// times and lunch gap, reusing the same in/out/lunch vocabulary as the Daily records tab.
function renderDetailCalendar({days, emps, hours, openFlags, sessionsByDay, employeeStats}){
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

    for(let d=1; d<=days; d++){
      const sessions = sessionsForEmp[d];
      const open = openFlags[e.id][d];
      const hasHours = hours[e.id][d] !== null;
      const auto = sessions && sessions.some(s => s.clock_out && !s.out_photo);
      const pill = document.createElement('div');
      pill.className = 'daypill' + (open ? ' review' : hasHours ? ' full' : '') + (auto ? ' auto' : '');
      pill.textContent = open ? '!' : hasHours ? d : '';
      if(sessions){
        pill.onclick = () => toggleDayDetail(tr, sessions);
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
}

// Toggles the row's detail panel: closes if the same day's pill is clicked again, otherwise
// rebuilds it from that day's sessions (same in/out/lunch chip vocabulary as Daily records).
function toggleDayDetail(tr, sessions){
  const row = tr._detailRow, inner = tr._detailInner;
  if(row.classList.contains('open') && row._sessions === sessions){
    row.classList.remove('open');
    return;
  }
  inner.innerHTML = '';
  const dateLabel = document.createElement('span'); dateLabel.className = 'detail-date';
  dateLabel.textContent = new Date(sessions[0].date + 'T00:00:00').toLocaleDateString('en-IN', {month:'short', day:'numeric'});
  inner.appendChild(dateLabel);
  sessions.forEach((s, i) => {
    if(i > 0){
      const gapHours = (new Date(s.clock_in) - new Date(sessions[i-1].clock_out)) / 3600000;
      const auto = !sessions[i-1].out_photo;
      const lunchChip = document.createElement('span'); lunchChip.className = 'chip lunch';
      lunchChip.textContent = `Lunch ${fmtHours(gapHours)}${auto ? ' (auto)' : ''}`;
      inner.appendChild(lunchChip);
    }
    const inChip = document.createElement('span'); inChip.className = 'chip';
    inChip.innerHTML = `<span class="lbl">In</span>${fmtTime(s.clock_in)}`;
    inner.appendChild(inChip);
    const outChip = document.createElement('span'); outChip.className = 'chip' + (s.clock_out ? '' : ' review');
    outChip.innerHTML = `<span class="lbl">Out</span>${s.clock_out ? fmtTime(s.clock_out) : 'Still in'}`;
    inner.appendChild(outChip);
  });
  const totalHours = sessions.reduce((sum, s) => sum + (recHours(s) || 0), 0);
  const stillOpen = sessions.some(s => !s.clock_out);
  const totalSpan = document.createElement('span'); totalSpan.className = 'detail-total';
  totalSpan.innerHTML = `Worked <b>${fmtHours(totalHours)}</b>${stillOpen ? ' so far' : ''}`;
  inner.appendChild(totalSpan);
  row._sessions = sessions;
  row.classList.add('open');
}

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
