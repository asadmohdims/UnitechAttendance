import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAutoClosedSession, countedClockOut, endOfDayFor } from './autoClosed.js';
import { recHours } from './utils.js';
import { recHoursRounded } from './rounding.js';
import { dayHoursFromSessions } from './reportMath.js';

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
// Shakib's real case: in 2:02 PM, system auto-closed at midnight, no photo.
const autoClosed = () => ({ clock_in: at(6, 14, 2), clock_out: at(7, 0), out_photo: null });

describe('isAutoClosedSession', () => {
  test('midnight clock-out with no photo -> true', () => assert.equal(isAutoClosedSession(autoClosed()), true));
  test('midnight clock-out WITH a photo is a real punch -> false', () =>
    assert.equal(isAutoClosedSession({ ...autoClosed(), out_photo: 'x.jpg' }), false));
  test('owner-corrected time (no photo, not midnight) -> false', () =>
    assert.equal(isAutoClosedSession({ ...autoClosed(), clock_out: at(6, 20, 30) }), false));
  test('still open -> false', () => assert.equal(isAutoClosedSession({ ...autoClosed(), clock_out: null }), false));
});

describe('countedClockOut', () => {
  test('auto-closed is capped at closing time (6 PM) on the clock-in day', () =>
    assert.equal(countedClockOut(autoClosed()), at(6, 18, 0)));
  test('clocked in after closing -> counts zero, never negative', () => {
    const late = { clock_in: at(6, 19, 30), clock_out: at(7, 0), out_photo: null };
    assert.equal(countedClockOut(late), late.clock_in);
    assert.equal(recHours(late), 0);
  });
  test('normal record is untouched', () => {
    const r = { clock_in: at(6, 9), clock_out: at(6, 13), out_photo: 'x.jpg' };
    assert.equal(countedClockOut(r), r.clock_out);
  });
  test('endOfDayFor is midnight after the clock-in day', () => assert.equal(endOfDayFor(autoClosed()).getTime(), new Date(2026, 9, 7).getTime()));
});

describe('hours from an auto-closed session', () => {
  test('exact hours are 2:02 PM to 6 PM, not 9:58', () => assert.ok(Math.abs(recHours(autoClosed()) - (3 + 58 / 60)) < 1e-9));
  test('paid hours are rounded 2:00 PM to 6:00 PM = 4', () => assert.equal(recHoursRounded(autoClosed()), 4));
  test('a lunch-paid chain ending in an auto-closed session still counts to closing', () => {
    const morning = { clock_in: at(6, 9, 18), clock_out: at(6, 13), out_photo: null, lunch_paid: true };
    const {total} = dayHoursFromSessions([morning, autoClosed()], recHoursRounded);
    // one continuous span 9:15 AM -> 6:00 PM
    assert.equal(total, 8.75);
  });
});
