// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { latestPunchByEmployee, punchLockedUntil } from './punchCooldown.js';

const at = (h, m, s = 0) => new Date(2026, 8, 24, h, m, s);

describe('latestPunchByEmployee', () => {
  test('picks the latest of clock-ins and clock-outs, per employee', () => {
    const records = [
      { emp_id: 'a', clock_in: at(9, 32).toISOString(), clock_out: at(13, 15).toISOString() },
      { emp_id: 'a', clock_in: at(13, 15, 30).toISOString(), clock_out: null },
      { emp_id: 'b', clock_in: at(9, 0).toISOString(), clock_out: at(12, 0).toISOString() }
    ];
    assert.deepEqual(latestPunchByEmployee(records), {
      a: at(13, 15, 30).toISOString(), // the open session's clock-in beats the earlier clock-out
      b: at(12, 0).toISOString()       // a closed session's clock-out beats its own clock-in
    });
  });

  test('does not depend on record order', () => {
    const records = [
      { emp_id: 'a', clock_in: at(14, 0).toISOString(), clock_out: at(18, 0).toISOString() },
      { emp_id: 'a', clock_in: at(9, 0).toISOString(), clock_out: at(13, 0).toISOString() }
    ];
    assert.deepEqual(latestPunchByEmployee(records), { a: at(18, 0).toISOString() });
  });

  test('no records -> empty map', () => {
    assert.deepEqual(latestPunchByEmployee([]), {});
  });
});

describe('punchLockedUntil', () => {
  test('no punch yet today -> allowed', () => {
    assert.equal(punchLockedUntil(undefined, 2, at(9, 0)), null);
  });

  test('retap 30s after a punch -> locked until 2 min after that punch', () => {
    const until = punchLockedUntil(at(13, 15).toISOString(), 2, at(13, 15, 30));
    assert.deepEqual(until, at(13, 17));
  });

  test('exactly at the window boundary -> allowed', () => {
    assert.equal(punchLockedUntil(at(13, 15).toISOString(), 2, at(13, 17)), null);
  });

  test('well after the window (a normal lunch return) -> allowed', () => {
    assert.equal(punchLockedUntil(at(13, 15).toISOString(), 2, at(14, 24)), null);
  });

  test('a punch dated in the future never locks (admin-entered time, clock skew)', () => {
    assert.equal(punchLockedUntil(at(18, 0).toISOString(), 2, at(15, 0)), null);
  });
});
