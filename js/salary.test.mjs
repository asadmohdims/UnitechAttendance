// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { periodEndDate, pickRateForPeriod, calcSalary, fmtCurrency, fmtRate } from './salary.js';

describe('periodEndDate', () => {
  test('a fully elapsed month uses its own last day, regardless of today', () => {
    assert.equal(periodEndDate('2026-08', '2026-09-09'), '2026-08-31');
  });

  test('the current, in-progress month is capped at today', () => {
    assert.equal(periodEndDate('2026-09', '2026-09-09'), '2026-09-09');
  });

  test('a non-leap February has 28 days', () => {
    assert.equal(periodEndDate('2026-02', '2026-03-01'), '2026-02-28');
  });

  test('a leap February has 29 days', () => {
    assert.equal(periodEndDate('2028-02', '2028-03-01'), '2028-02-29');
  });
});

describe('pickRateForPeriod', () => {
  test('no rates at all returns null', () => {
    assert.equal(pickRateForPeriod([], '2026-09-09'), null);
    assert.equal(pickRateForPeriod(undefined, '2026-09-09'), null);
  });

  test('a rate dated after the period end is not picked', () => {
    const rates = [{effective_from: '2026-10-01', monthly_salary: 20000, created_at: '2026-09-01T00:00:00Z'}];
    assert.equal(pickRateForPeriod(rates, '2026-09-30'), null);
  });

  // This is the core business rule: an amendment entered mid-month applies to the WHOLE
  // month, including days already worked before the change — not just going forward.
  test('a mid-period amendment wins for the whole period (retroactive within period)', () => {
    const rates = [
      {effective_from: '2026-09-01', monthly_salary: 18000, created_at: '2026-09-01T00:00:00Z'},
      {effective_from: '2026-09-09', monthly_salary: 20000, created_at: '2026-09-09T00:00:00Z'}
    ];
    const picked = pickRateForPeriod(rates, '2026-09-09');
    assert.equal(picked.monthly_salary, 20000);
  });

  // And the flip side of the same rule: a month that has already fully elapsed must NOT be
  // repriced by a later amendment — this is what makes "show the calculation" trustworthy.
  test('an already-elapsed month keeps its historical rate, unaffected by a later amendment', () => {
    const rates = [
      {effective_from: '2026-08-01', monthly_salary: 18000, created_at: '2026-08-01T00:00:00Z'},
      {effective_from: '2026-09-09', monthly_salary: 20000, created_at: '2026-09-09T00:00:00Z'}
    ];
    const picked = pickRateForPeriod(rates, '2026-08-31'); // August's own period end
    assert.equal(picked.monthly_salary, 18000);
  });

  test('effective_from exactly on the period end is included (inclusive boundary)', () => {
    const rates = [{effective_from: '2026-09-30', monthly_salary: 25000, created_at: '2026-09-30T00:00:00Z'}];
    assert.equal(pickRateForPeriod(rates, '2026-09-30').monthly_salary, 25000);
  });

  test('input order does not matter — the function sorts for itself', () => {
    const rates = [
      {effective_from: '2026-09-09', monthly_salary: 20000, created_at: '2026-09-09T00:00:00Z'},
      {effective_from: '2026-08-01', monthly_salary: 18000, created_at: '2026-08-01T00:00:00Z'},
      {effective_from: '2026-06-01', monthly_salary: 15000, created_at: '2026-06-01T00:00:00Z'}
    ];
    assert.equal(pickRateForPeriod(rates, '2026-09-09').monthly_salary, 20000);
  });

  // Two amendments on the same day (e.g. a typo entered, then immediately corrected) must
  // deterministically pick the one entered last — not whatever order Array.sort() happens
  // to leave them in when their effective_from ties. Checking both input orderings matters:
  // a comparator that returns -1 for equal keys (instead of 0) is order-dependent, so it can
  // silently pass for one array order and fail for the other depending on the engine's sort
  // internals — a single fixed ordering isn't a reliable regression guard for this bug.
  test('a same-day tie breaks on created_at — the later entry wins, regardless of input order', () => {
    const typo = {effective_from: '2026-09-09', monthly_salary: 18000, created_at: '2026-09-09T10:00:00Z'};
    const correction = {effective_from: '2026-09-09', monthly_salary: 20000, created_at: '2026-09-09T10:05:00Z'};
    assert.equal(pickRateForPeriod([typo, correction], '2026-09-09').monthly_salary, 20000);
    assert.equal(pickRateForPeriod([correction, typo], '2026-09-09').monthly_salary, 20000);
  });
});

describe('calcSalary', () => {
  test('prorates a monthly salary by the hours-worked ratio', () => {
    const {amount, ratio} = calcSalary({monthlySalary: 18000, hoursWorked: 16, standardHours: 208});
    assert.equal(ratio, 16 / 208);
    assert.ok(Math.abs(amount - 1384.6153846153845) < 1e-9);
  });

  test('zero hours worked means zero pay', () => {
    assert.equal(calcSalary({monthlySalary: 18000, hoursWorked: 0, standardHours: 208}).amount, 0);
  });

  // Documented current behavior, not a bug: v1 has no overtime cap, so hours above the
  // standard produce more than the full monthly salary — this test just pins down what "no cap"
  // actually does. `standardHours` here is a plain number the caller supplies; js/ui/salary.js
  // is what computes it per month (calendar days × STANDARD_DAY_HOURS, the owner's own call,
  // 2026-09-12) — this pure function doesn't care where it came from.
  test('hours above the standard are not capped', () => {
    const {amount} = calcSalary({monthlySalary: 18000, hoursWorked: 416, standardHours: 208});
    assert.equal(amount, 36000);
  });
});

describe('fmtCurrency', () => {
  test('null/undefined render as an em dash, not "₹NaN" or "₹null"', () => {
    assert.equal(fmtCurrency(null), '—');
    assert.equal(fmtCurrency(undefined), '—');
  });

  test('rounds to the nearest rupee for display only', () => {
    assert.equal(fmtCurrency(1384.6153846153845), '₹1,385');
  });

  test('uses Indian digit grouping (lakhs), not thousands', () => {
    assert.equal(fmtCurrency(1234567), '₹12,34,567');
  });
});

describe('fmtRate', () => {
  test('null/undefined render as an em dash', () => {
    assert.equal(fmtRate(null), '—');
    assert.equal(fmtRate(undefined), '—');
  });

  // Unlike fmtCurrency, this must NOT round to the nearest rupee — a rate is a multiplicand
  // shown so an owner can multiply it back out and land on the same headline total; rounding it
  // the way a final pay figure rounds would make that check fail.
  test('keeps two decimal places, not rounded to the nearest rupee like fmtCurrency', () => {
    assert.equal(fmtRate(16000 / 208), '₹76.92');
  });
});
