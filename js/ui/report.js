import { $, busy, toast, pad, fmtHours, dateStr, shiftMonthInput } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { switchTab } from './shell.js';
import { setRecordsDate } from './records.js';
import { buildDayHours } from '../reportMath.js';

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
  return {ym, days, emps, hours, openFlags, recs, openRecords:recs.filter(r => !r.clock_out), hasData: recs.length > 0};
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
  const {ym, days, emps, hours, openFlags, openRecords, hasData} = md;
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

  let h = '<tr><th>Employee</th>';
  for(let d=1; d<=days; d++) h += `<th class="num">${d}</th>`;
  h += '<th class="num">Days</th><th class="num">Total hrs</th></tr>';
  document.querySelector('#reportTable thead').innerHTML = h;
  const tbody = document.querySelector('#reportTable tbody');
  tbody.innerHTML = '';
  emps.forEach(e => {
    let total = 0, daysWorked = 0, row = '';
    for(let d=1; d<=days; d++){
      const v = hours[e.id][d];
      // Accumulation and display are separate on purpose: a day can be BOTH already-banked
      // hours (a closed morning session) AND still open (an afternoon session in progress) —
      // the IN badge must never cause those banked hours to silently drop from the total.
      if(v !== null){ total += v; daysWorked++; }
      if(openFlags[e.id][d]) row += '<td class="num open-session">IN</td>';
      else if(v === null) row += '<td class="num muted">·</td>';
      else row += `<td class="num">${fmtHours(v)}</td>`;
    }
    const tr = document.createElement('tr');
    const tdN = document.createElement('td'); tdN.textContent = e.name;
    tr.appendChild(tdN);
    tr.insertAdjacentHTML('beforeend', row + `<td class="num"><b>${daysWorked}</b></td><td class="num"><b>${fmtHours(total)}</b></td>`);
    tbody.appendChild(tr);
  });
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
