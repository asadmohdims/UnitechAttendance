// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { missedCutoffFor, isMissedClockIn } from './missedClockIn.js';

describe('missedCutoffFor', () => {
  test('returns today\'s configured cutoff (10:00 AM by default), same calendar day as `now`', () => {
    const now = new Date(2026, 8, 11, 9, 30); // Sep 11, 2026, 9:30 AM
    const cutoff = missedCutoffFor(now);
    assert.equal(cutoff.getFullYear(), 2026);
    assert.equal(cutoff.getMonth(), 8);
    assert.equal(cutoff.getDate(), 11);
    assert.equal(cutoff.getHours(), 10);
    assert.equal(cutoff.getMinutes(), 0);
  });
});

describe('isMissedClockIn', () => {
  test('already punched today -> false regardless of time', () => {
    assert.equal(isMissedClockIn(true, new Date(2026, 8, 11, 18, 0)), false);
  });

  test('not punched, before the cutoff -> false', () => {
    assert.equal(isMissedClockIn(false, new Date(2026, 8, 11, 9, 59)), false);
  });

  test('not punched, exactly at the cutoff -> true', () => {
    assert.equal(isMissedClockIn(false, new Date(2026, 8, 11, 10, 0)), true);
  });

  test('not punched, well after the cutoff -> true', () => {
    assert.equal(isMissedClockIn(false, new Date(2026, 8, 11, 15, 0)), true);
  });
});
