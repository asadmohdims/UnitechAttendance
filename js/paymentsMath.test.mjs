// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDay, groupByEmployeeDate, employeeLoggedTotal, paymentsSummary } from './paymentsMath.js';

describe('reconcileDay', () => {
  test('both sides logged, equal amounts -> matched', () => {
    const r = reconcileDay([
      { amount: 5000, entered_by: 'employee' },
      { amount: 5000, entered_by: 'owner' }
    ]);
    assert.equal(r.status, 'matched');
    assert.equal(r.employeeTotal, 5000);
    assert.equal(r.ownerTotal, 5000);
  });

  test('both sides logged, different amounts -> mismatch', () => {
    const r = reconcileDay([
      { amount: 4500, entered_by: 'employee' },
      { amount: 5000, entered_by: 'owner' }
    ]);
    assert.equal(r.status, 'mismatch');
    assert.equal(r.employeeTotal, 4500);
    assert.equal(r.ownerTotal, 5000);
  });

  test('only the employee logged -> awaiting-owner', () => {
    const r = reconcileDay([{ amount: 4000, entered_by: 'employee' }]);
    assert.equal(r.status, 'awaiting-owner');
    assert.equal(r.ownerTotal, 0);
  });

  test('only the owner logged -> awaiting-employee', () => {
    const r = reconcileDay([{ amount: 4000, entered_by: 'owner' }]);
    assert.equal(r.status, 'awaiting-employee');
    assert.equal(r.employeeTotal, 0);
  });

  test('multiple entries on the same side are summed before comparing', () => {
    const r = reconcileDay([
      { amount: 2000, entered_by: 'employee' },
      { amount: 3000, entered_by: 'employee' },
      { amount: 5000, entered_by: 'owner' }
    ]);
    assert.equal(r.status, 'matched');
    assert.equal(r.employeeTotal, 5000);
  });
});

describe('groupByEmployeeDate', () => {
  test('groups by the emp_id+date pair, not by employee or date alone', () => {
    const groups = groupByEmployeeDate([
      { emp_id: 'a', occurred_on: '2026-09-10', amount: 100, entered_by: 'employee' },
      { emp_id: 'a', occurred_on: '2026-09-10', amount: 100, entered_by: 'owner' },
      { emp_id: 'a', occurred_on: '2026-09-11', amount: 200, entered_by: 'employee' },
      { emp_id: 'b', occurred_on: '2026-09-10', amount: 300, entered_by: 'owner' }
    ]);
    assert.equal(groups.length, 3);
    const aSep10 = groups.find(g => g.emp_id === 'a' && g.date === '2026-09-10');
    assert.equal(aSep10.payments.length, 2);
  });
});

describe('employeeLoggedTotal', () => {
  test('sums only the employee-entered rows, ignoring the owner\'s side', () => {
    const total = employeeLoggedTotal([
      { amount: 5000, entered_by: 'employee' },
      { amount: 2000, entered_by: 'employee' },
      { amount: 9999, entered_by: 'owner' }
    ]);
    assert.equal(total, 7000);
  });
});

describe('paymentsSummary', () => {
  test('rolls matched/awaiting/mismatch counts and an effective total up across days', () => {
    const groups = groupByEmployeeDate([
      { emp_id: 'a', occurred_on: '2026-09-10', amount: 5000, entered_by: 'employee' },
      { emp_id: 'a', occurred_on: '2026-09-10', amount: 5000, entered_by: 'owner' },
      { emp_id: 'b', occurred_on: '2026-09-10', amount: 4000, entered_by: 'employee' },
      { emp_id: 'c', occurred_on: '2026-09-07', amount: 4500, entered_by: 'employee' },
      { emp_id: 'c', occurred_on: '2026-09-07', amount: 5000, entered_by: 'owner' }
    ]);
    const summary = paymentsSummary(groups);
    assert.equal(summary.matchedCount, 1);
    assert.equal(summary.awaitingCount, 1);
    assert.equal(summary.mismatchCount, 1);
    // matched (5000) + awaiting-owner (4000, the only side logged) + mismatch (max(4500,5000)=5000)
    assert.equal(summary.totalLogged, 14000);
  });
});
