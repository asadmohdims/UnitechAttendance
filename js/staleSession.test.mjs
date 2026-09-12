// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoCloseStaleSession, endOfDayFor } from './staleSession.js';

describe('shouldAutoCloseStaleSession', () => {
  test('open session from a prior day, now a new day -> true', () => {
    const yesterday = { clock_in: new Date(2026, 8, 10, 9, 0).toISOString(), clock_out: null };
    const now = new Date(2026, 8, 11, 0, 5); // just past midnight
    assert.equal(shouldAutoCloseStaleSession(yesterday, now), true);
  });

  test('open session from many days ago is still caught, not just yesterday', () => {
    const lastWeek = { clock_in: new Date(2026, 8, 4, 9, 0).toISOString(), clock_out: null };
    const now = new Date(2026, 8, 11, 8, 0);
    assert.equal(shouldAutoCloseStaleSession(lastWeek, now), true);
  });

  test('open session from earlier today -> false (this is js/lunch.js\'s job, not this one)', () => {
    const thisMorning = { clock_in: new Date(2026, 8, 11, 9, 0).toISOString(), clock_out: null };
    const now = new Date(2026, 8, 11, 23, 0);
    assert.equal(shouldAutoCloseStaleSession(thisMorning, now), false);
  });

  test('already closed -> false regardless of how old it is', () => {
    const closed = { clock_in: new Date(2026, 8, 1, 9, 0).toISOString(), clock_out: new Date(2026, 8, 1, 17, 0).toISOString() };
    const now = new Date(2026, 8, 11, 8, 0);
    assert.equal(shouldAutoCloseStaleSession(closed, now), false);
  });

  test('no record -> false', () => {
    assert.equal(shouldAutoCloseStaleSession(null, new Date(2026, 8, 11, 8, 0)), false);
  });
});

describe('endOfDayFor', () => {
  test('returns midnight at the START of the day AFTER clock_in (00:00, not 23:59)', () => {
    const record = { clock_in: new Date(2026, 8, 10, 9, 15).toISOString() };
    const end = endOfDayFor(record);
    assert.equal(end.getFullYear(), 2026);
    assert.equal(end.getMonth(), 8);
    assert.equal(end.getDate(), 11); // rolled into the next day
    assert.equal(end.getHours(), 0);
    assert.equal(end.getMinutes(), 0);
    assert.equal(end.getSeconds(), 0);
  });

  test('rolls correctly across a month boundary', () => {
    const record = { clock_in: new Date(2026, 7, 31, 22, 0).toISOString() }; // Aug 31
    const end = endOfDayFor(record);
    assert.equal(end.getMonth(), 8); // September
    assert.equal(end.getDate(), 1);
    assert.equal(end.getHours(), 0);
  });
});
