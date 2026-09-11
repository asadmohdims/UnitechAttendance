import { $, busy, toast, fmtHours, dateStr, shiftMonthInput } from '../utils.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { monthData, summarizeHours } from './report.js';
import { pickRateForPeriod, calcSalary, periodEndDate, fmtCurrency } from '../salary.js';
import { STANDARD_MONTHLY_HOURS } from '../config.js';
import { promptModal } from './modal.js';

const salMonth = $('salMonth');
salMonth.value = dateStr().slice(0, 7);
salMonth.onchange = renderSalary;

$('btnSalPrevMonth').onclick = () => shiftMonthInput(salMonth, -1, renderSalary);
$('btnSalNextMonth').onclick = () => shiftMonthInput(salMonth, 1, renderSalary);

export async function renderSalary(){
  busy(true);
  const ym = salMonth.value;
  const md = await monthData(ym);
  if(!md){ busy(false); return; }
  const periodEnd = periodEndDate(ym);
  const isCurrentMonth = ym === dateStr().slice(0, 7);

  let rates;
  try{
    rates = {};
    await Promise.all(md.emps.map(async e => { rates[e.id] = await store.listSalaryRates(e.id); }));
  }catch(err){
    busy(false);
    toast('Load failed: ' + err.message);
    return;
  }
  busy(false);

  $('salMonthLabel').textContent = new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-IN', {month:'long', year:'numeric'});
  $('salEmpty').style.display = md.emps.length ? 'none' : '';

  const list = $('salaryList');
  list.innerHTML = '';
  md.emps.forEach(e => {
    const {total, daysWorked} = summarizeHours(md.hours[e.id], md.days);
    const rate = pickRateForPeriod(rates[e.id], periodEnd);
    const calc = rate ? calcSalary({monthlySalary:rate.monthly_salary, hoursWorked:total, standardHours:STANDARD_MONTHLY_HOURS}) : null;

    const row = document.createElement('div');
    row.className = 'salary-person';
    const avatar = document.createElement('img');
    avatar.className = 'report-avatar'; avatar.alt = '';
    applyAvatar(avatar, e);
    const who = document.createElement('div'); who.className = 'salary-who';
    const name = document.createElement('div'); name.className = 'report-name'; name.textContent = e.name;
    const rateLine = document.createElement('div'); rateLine.className = 'report-detail';
    rateLine.textContent = rate ? `${fmtCurrency(rate.monthly_salary)}/mo · since ${rate.effective_from}` : 'No rate set';
    who.append(name, rateLine);
    const amount = document.createElement('div'); amount.className = 'salary-amount';
    amount.innerHTML = `<span>Est. pay ${isCurrentMonth ? 'so far' : 'this month'}</span><strong>${calc ? fmtCurrency(calc.amount) : '—'}</strong>`;
    const actions = document.createElement('div'); actions.className = 'salary-actions';
    const bCalc = document.createElement('button'); bCalc.className = 'btn small ghost'; bCalc.textContent = 'Show calculation';
    const bAmend = document.createElement('button'); bAmend.className = 'btn small ghost'; bAmend.textContent = 'Amend';
    actions.append(bCalc, bAmend);
    row.append(avatar, who, amount, actions);

    const detail = document.createElement('div');
    detail.className = 'salary-calc-detail';
    detail.style.display = 'none';
    detail.innerHTML = rate
      ? `<p><b>Rate used:</b> ${fmtCurrency(rate.monthly_salary)}/month, effective from ${rate.effective_from}</p>
         <p><b>Hours worked:</b> ${fmtHours(total)} over ${daysWorked} ${daysWorked === 1 ? 'day' : 'days'}</p>
         <p><b>Standard hours:</b> ${STANDARD_MONTHLY_HOURS}/month</p>
         <p><b>Formula:</b> ${fmtCurrency(rate.monthly_salary)} × (${total.toFixed(1)} ÷ ${STANDARD_MONTHLY_HOURS} hrs) = ${fmtCurrency(calc.amount)}</p>`
      : `<p>No salary rate has been set for ${e.name} yet — use Amend to add one.</p>`;
    bCalc.onclick = () => {
      const open = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : '';
      bCalc.textContent = open ? 'Show calculation' : 'Hide calculation';
    };
    bAmend.onclick = () => amendRate(e, rate);

    list.append(row, detail);
  });
}

async function amendRate(emp, currentRate){
  const result = await promptModal({
    title: `Amend salary — ${emp.name}`,
    submitLabel: 'Save rate',
    fields: [
      {name:'amount', label:'Monthly salary (₹)', type:'number', value: currentRate ? currentRate.monthly_salary : '', placeholder:'e.g. 18000', min:1},
      {name:'effectiveFrom', label:'Effective from', type:'date', value: dateStr()}
    ]
  });
  if(!result) return;
  const monthlySalary = Number(result.amount);
  if(!monthlySalary || monthlySalary <= 0) return toast('Enter a valid amount');
  busy(true);
  try{
    await store.setSalaryRate(emp.id, {monthlySalary, effectiveFrom: result.effectiveFrom, note:null});
    await renderSalary();
    toast(`Salary updated for ${emp.name}`);
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}
