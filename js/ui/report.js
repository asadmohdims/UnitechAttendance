import { $, busy, toast, pad, fmtHours, recHours } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { dateStr } from '../utils.js';
import { switchTab } from './shell.js';
import { setRecordsDate } from './records.js';

const repMonth = $('repMonth');
repMonth.value = dateStr().slice(0,7);
repMonth.onchange = renderReport;
let lastReportData = null;

function shiftReportMonth(change){
  const [year, month] = repMonth.value.split('-').map(Number);
  const next = new Date(year, month - 1 + change, 1);
  repMonth.value = `${next.getFullYear()}-${pad(next.getMonth()+1)}`;
  renderReport();
}
$('btnPrevMonth').onclick = () => shiftReportMonth(-1);
$('btnNextMonth').onclick = () => shiftReportMonth(1);
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

async function monthData(){
  const ym = repMonth.value; // YYYY-MM
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
  const hours = {}; // hours[empId][day] = total hours (null none, -1 open session)
  emps.forEach(e => hours[e.id] = Array(days+1).fill(null));
  recs.forEach(r => {
    if(!hours[r.emp_id]) return;
    const d = Number(r.date.slice(8,10));
    const h = recHours(r);
    if(h === null){ if(hours[r.emp_id][d] === null) hours[r.emp_id][d] = -1; }
    else hours[r.emp_id][d] = (hours[r.emp_id][d] === null || hours[r.emp_id][d] === -1 ? 0 : hours[r.emp_id][d]) + h;
  });
  return {ym, days, emps, hours, recs, openRecords:recs.filter(r => !r.clock_out), hasData: recs.length > 0};
}

export async function renderReport(){
  busy(true);
  const md = await monthData();
  busy(false);
  if(!md) return;
  lastReportData = md;
  const {ym, days, emps, hours, openRecords, hasData} = md;
  $('repEmpty').style.display = hasData ? 'none' : '';
  $('reportMonthLabel').textContent = new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-IN', {month:'long', year:'numeric'});
  let totalHours = 0, attendanceDays = 0;
  const employeeStats = emps.map(e => {
    let total = 0, daysWorked = 0, hasOpen = false;
    for(let d=1; d<=days; d++){
      const v = hours[e.id][d];
      if(v === -1) hasOpen = true;
      else if(v !== null){ total += v; daysWorked++; }
    }
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
    const days = document.createElement('span'); days.className = 'report-detail'; days.textContent = `${daysWorked} ${daysWorked === 1 ? 'attendance day' : 'attendance days'}`;
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
      if(v === null) row += '<td class="num muted">·</td>';
      else if(v === -1) row += '<td class="num open-session">IN</td>';
      else { total += v; daysWorked++; row += `<td class="num">${fmtHours(v)}</td>`; }
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
  const md = await monthData();
  busy(false);
  if(!md) return;
  const {ym, days, emps, hours} = md;
  const header = ['Employee', ...Array.from({length:days}, (_,i) => `${ym}-${pad(i+1)}`), 'Days worked', 'Total hours'];
  const rows = emps.map(e => {
    let total = 0, daysWorked = 0;
    const cells = [];
    for(let d=1; d<=days; d++){
      const v = hours[e.id][d];
      if(v === null) cells.push('');
      else if(v === -1) cells.push('IN (no out)');
      else { total += v; daysWorked++; cells.push(Number(v.toFixed(2))); }
    }
    return [e.name, ...cells, daysWorked, Number(total.toFixed(2))];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{wch:18}, ...Array(days).fill({wch:10}), {wch:11}, {wch:11}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ym);
  XLSX.writeFile(wb, `attendance-${ym}.xlsx`);
};
