import { $, busy, toast, fmtHours, dateStr, shiftMonthInput } from '../utils.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { monthData, summarizeHours } from './report.js';
import { pickRateForPeriod, calcSalary, periodEndDate, fmtCurrency, fmtRate } from '../salary.js';
import { STANDARD_DAY_HOURS } from '../config.js';
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
    // Pay is based on payHours (each punch rounded to the nearest 15 min — see js/rounding.js)
    // — not the exact hours Report/Records show.
    const {total, daysWorked} = summarizeHours(md.payHours[e.id], md.days);
    const dockedCount = md.dockedDays[e.id].filter(Boolean).length;
    // Every 'holiday' gap day this employee had this month, docked or not — shown alongside
    // daysWorked so a paid Friday (zero punches) doesn't read as an unexplained gap between
    // "days worked" and the days actually in the month.
    const totalFridays = md.gapStatus[e.id].filter(s => s === 'holiday').length;
    const paidFridays = totalFridays - dockedCount;
    // Calendar-day method (the owner's explicit call, 2026-09-12): standard hours = THIS month's
    // actual day count × the shop's standard day length — January's 31, February's 28, not a
    // fixed 26. A weekly holiday must still cost nothing under that denominator, so a paid Friday
    // is credited its own 8h here even though nothing was punched; a docked one just isn't
    // credited (no separate subtraction needed — see calcSalary()'s own comment in js/salary.js).
    const creditedHours = paidFridays * STANDARD_DAY_HOURS;
    // Manual overtime (js/ui/records.js's addOrEditOvertime), paid at the same hourly rate as
    // regular hours (the owner's call, no multiplier) — already folded into payHours by
    // monthData() (see js/ui/report.js), so `total` above already includes it. Recomputed here
    // only so the breakdown below can call it out as its own line, not to add it a second time.
    const overtimeTotal = md.overtimeHours[e.id].reduce((a, b) => a + b, 0);
    const hoursForPay = total + creditedHours;
    const standardHours = md.days * STANDARD_DAY_HOURS;
    const rate = pickRateForPeriod(rates[e.id], periodEnd);
    const hourlyRate = rate ? rate.monthly_salary / standardHours : null;
    const calc = rate ? calcSalary({monthlySalary:rate.monthly_salary, hoursWorked:hoursForPay, standardHours}) : null;

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

    // Note appended to "Days worked" so a paid Friday's absence from that count is explained
    // right there instead of left as a silent gap between it and the days actually in the month.
    let fridayNote = '';
    if(totalFridays > 0){
      if(dockedCount === 0) fridayNote = ` (+ ${paidFridays} paid Friday${paidFridays === 1 ? '' : 's'})`;
      else if(paidFridays === 0) fridayNote = ` (${dockedCount} Friday${dockedCount === 1 ? '' : 's'} marked unpaid)`;
      else fridayNote = ` (+ ${paidFridays} paid Friday${paidFridays === 1 ? '' : 's'}, ${dockedCount} marked unpaid)`;
    }

    // `total` already has overtime folded in (via payHours, in monthData()) — the displayed
    // base figure here needs it subtracted back out, or listing "+ 4:00 (overtime)" again on
    // top of a total that already contains it would make the shown equation not add up (e.g.
    // "12:00 + 4:00 (overtime) = 28:00" when 12:00 already included that 4:00).
    const basePunchedHours = total - overtimeTotal;
    // "Hours worked" needs to show every term that feeds into what Total pay actually
    // multiplies (Friday credit, overtime) — otherwise this row and the final formula could
    // silently disagree. Built from whichever terms are actually present this month, never
    // assuming both are there.
    const hoursWorkedParts = [];
    if(creditedHours) hoursWorkedParts.push(`${fmtHours(creditedHours)} (${paidFridays} paid Friday${paidFridays === 1 ? '' : 's'})`);
    if(overtimeTotal) hoursWorkedParts.push(`${fmtHours(overtimeTotal)} (overtime)`);
    const hoursWorkedNote = hoursWorkedParts.length
      ? ` + ${hoursWorkedParts.join(' + ')} = ${fmtHours(hoursForPay)}`
      : '';

    const detail = document.createElement('div');
    detail.className = 'salary-calc-detail';
    detail.style.display = 'none';
    // A real table, not paragraphs — aligned, bordered rows read like a payroll ledger line (and
    // paste cleanly into a spreadsheet) rather than prose sentences. Every row builds toward the
    // next: rate -> the hourly rate it implies -> how many hours that was actually paid for ->
    // the final multiplication, in that order, so an owner can read straight down the table and
    // reconstruct the headline number without holding anything in their head. fmtHours() on every
    // hours figure (never a raw decimal) so nothing needs converting to check it against what
    // Report/Records show for the same days.
    detail.innerHTML = rate
      ? `<table class="calc-table">
           <tr><th>Rate used</th><td>${fmtCurrency(rate.monthly_salary)}/month, effective from ${rate.effective_from}</td></tr>
           <tr><th>Hourly rate</th><td>${fmtCurrency(rate.monthly_salary)} ÷ ${fmtHours(standardHours)} hrs (this month's ${md.days} days × ${STANDARD_DAY_HOURS}h) = ${fmtRate(hourlyRate)}/hr</td></tr>
           <tr><th>Days worked (actual)</th><td>${daysWorked}${fridayNote}</td></tr>
           <tr><th>Hours worked</th><td>${fmtHours(basePunchedHours)}${hoursWorkedNote}</td></tr>
           ${dockedCount ? `<tr><th>Docked</th><td>${dockedCount} Friday${dockedCount === 1 ? '' : 's'} not credited this month (−${fmtHours(dockedCount * STANDARD_DAY_HOURS)} vs. a paid Friday)</td></tr>` : ''}
           <tr class="calc-total"><th>Total pay</th><td>${fmtRate(hourlyRate)}/hr × ${fmtHours(hoursForPay)} hrs = ${fmtCurrency(calc.amount)}</td></tr>
         </table>`
      : `<p>No salary rate has been set for ${e.name} yet — use Amend to add one.</p>`;
    bCalc.onclick = () => {
      const open = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : '';
      bCalc.textContent = open ? 'Show calculation' : 'Hide calculation';
    };
    bAmend.onclick = () => amendRate(e, rate);

    // Row + its (possibly open) calculation detail travel together as one bordered unit — before
    // this, the border-bottom lived on .salary-person itself, so it separated a row from ITS OWN
    // detail below it, but left nothing between that detail and the next employee's row, which is
    // what made an opened panel visually run into whoever came next.
    const item = document.createElement('div'); item.className = 'salary-item';
    item.append(row, detail);
    list.append(item);
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
