// Pure salary math — no store or DOM access, so the numbers here are exactly the numbers
// shown in the UI's "show calculation" breakdown, nothing hidden in between.
import { pad, dateStr } from './utils.js';

// The last day salary should account for, given a report-style 'YYYY-MM' month: the month's
// actual last day, or today if the month is still in progress (this is what makes the
// current month's figure a live, running total instead of a fixed end-of-month one).
// `today` is injectable (defaults to the real date) so this stays a pure function under test.
export function periodEndDate(ym, today = dateStr()){
  const [y, m] = ym.split('-').map(Number);
  const monthEnd = `${ym}-${pad(new Date(y, m, 0).getDate())}`;
  return today < monthEnd ? today : monthEnd;
}

// Pick the rate in effect for a period: the latest amendment whose effective_from is on or
// before the period's end. An amendment made mid-period (effective_from within the period)
// therefore wins for the whole period — retroactive to the period's start — while a period
// that has already fully elapsed keeps whatever rate was in force at the time.
// Ties on effective_from (e.g. a same-day correction) break on created_at, latest wins —
// without this, two rates sharing a date would fall back to whatever order Array.sort()
// happens to produce, which isn't something call sites should have to rely on.
export function pickRateForPeriod(rates, periodEnd){
  return (rates || [])
    .filter(r => r.effective_from <= periodEnd)
    .sort((a, b) => {
      if(a.effective_from !== b.effective_from) return a.effective_from < b.effective_from ? 1 : -1;
      return (b.created_at || '').localeCompare(a.created_at || '');
    })[0] || null;
}

// Plain ratio math — `standardHours` is the caller's job to get right (the calendar-day method:
// the actual number of days in THIS month × the shop's standard day length, computed in
// js/ui/salary.js from monthData()'s own `days`, not a fixed constant here). `hoursWorked` is
// likewise whatever the caller decides should count — including, for a paid Friday, a credited
// 8h even though nothing was punched (see js/ui/salary.js's `creditedHours`). Docking a holiday
// is therefore just *not* including its credit, not a separate subtraction step here — this
// function doesn't need to know Fridays exist at all.
export function calcSalary({monthlySalary, hoursWorked, standardHours}){
  const ratio = hoursWorked / standardHours;
  return {ratio, amount: monthlySalary * ratio};
}

export function fmtCurrency(amount){
  return amount == null ? '—' : '₹' + Math.round(amount).toLocaleString('en-IN');
}

// A per-hour rate needs more precision than a headline pay figure — fmtCurrency's rounding to
// the nearest rupee is fine for "the total you'll pay", but rounding the RATE the same way means
// rate × hours no longer reproduces the shown total, which defeats the point of showing the rate
// at all (an owner should be able to multiply it out and get the same number back).
export function fmtRate(amount){
  return amount == null ? '—' : '₹' + amount.toFixed(2);
}
