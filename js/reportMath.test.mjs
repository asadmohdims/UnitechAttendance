// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDayHours, groupByEmployeeDay, needsReview, dayOffStatus, isHalfDay } from './reportMath.js';

describe('buildDayHours', () => {
  const morning = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T09:00:00.000Z', clock_out: '2026-09-05T13:00:00.000Z' }; // 4h
  const afternoonOpen = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T14:00:00.000Z', clock_out: null };

  // This is the regression test: on the old code, whichever of these two records got
  // processed first determined whether the day's "still open" sentinel survived — a closed
  // session's hours would silently overwrite it. Fixed by tracking openFlags independently
  // of the hours sum, so the result must be identical regardless of processing order.
  test('a same-day closed + open session pair reports correctly in EITHER processing order', () => {
    for(const recs of [[morning, afternoonOpen], [afternoonOpen, morning]]){
      const {hours, openFlags} = buildDayHours(recs, ['e1'], 15);
      assert.equal(hours.e1[5], 4, `hours wrong for order ${JSON.stringify(recs.map(r => r.clock_in))}`);
      assert.equal(openFlags.e1[5], true);
    }
  });

  test('a day with only a closed session: correct total, not flagged open', () => {
    const {hours, openFlags} = buildDayHours([morning], ['e1'], 15);
    assert.equal(hours.e1[5], 4);
    assert.equal(openFlags.e1[5], false);
  });

  test('a day with only an open session: hours stays null (not counted), flagged open', () => {
    const {hours, openFlags} = buildDayHours([afternoonOpen], ['e1'], 15);
    assert.equal(hours.e1[5], null);
    assert.equal(openFlags.e1[5], true);
  });

  test('a day with no records at all: null hours, not flagged open', () => {
    const {hours, openFlags} = buildDayHours([], ['e1'], 15);
    assert.equal(hours.e1[5], null);
    assert.equal(openFlags.e1[5], false);
  });

  test('records for an employee not in empIds are ignored', () => {
    const stranger = { emp_id: 'e2', date: '2026-09-05', clock_in: '2026-09-05T09:00:00.000Z', clock_out: '2026-09-05T13:00:00.000Z' };
    const {hours} = buildDayHours([stranger], ['e1'], 15);
    assert.equal(hours.e2, undefined);
    assert.equal(hours.e1[5], null);
  });

  describe('lunch_paid (owner opts to pay through a lunch gap)', () => {
    // 9-12 (3h), lunch 12-13 (1h), 13-17 (4h). Un-flagged: 3+4=7h, the gap excluded.
    const morningSession = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T09:00:00.000Z', clock_out: '2026-09-05T12:00:00.000Z' };
    const afternoonSession = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T13:00:00.000Z', clock_out: '2026-09-05T17:00:00.000Z' };

    test('not flagged: the lunch gap is excluded as before', () => {
      const {hours} = buildDayHours([morningSession, afternoonSession], ['e1'], 15);
      assert.equal(hours.e1[5], 7);
    });

    test('flagged on the earlier session: the whole day becomes one continuous 9-17 span (8h)', () => {
      const flagged = {...morningSession, lunch_paid: true};
      const {hours} = buildDayHours([flagged, afternoonSession], ['e1'], 15);
      assert.equal(hours.e1[5], 8);
    });

    test('flagged session merges under a rounding hoursFn using the outer span, not two separately-rounded halves', () => {
      // Nearest-15 rounding a 9:07-12:53 half and a 13:15-17:00 half separately would give a
      // different total than rounding the single merged 9:07-17:00 span — this checks the
      // merge happens BEFORE hoursFn runs, not after.
      const roundToQuarter = ms => Math.round(ms / 900000) * 900000;
      const roundingHoursFn = r => r.clock_out ? Math.max(0, (roundToQuarter(new Date(r.clock_out).getTime()) - roundToQuarter(new Date(r.clock_in).getTime())) / 3600000) : null;
      const morning = {...morningSession, clock_in: '2026-09-05T09:07:00.000Z', clock_out: '2026-09-05T12:53:00.000Z', lunch_paid: true};
      const afternoon = {...afternoonSession, clock_in: '2026-09-05T13:15:00.000Z', clock_out: '2026-09-05T17:00:00.000Z'};
      const {hours} = buildDayHours([morning, afternoon], ['e1'], 15, roundingHoursFn);
      // Merged span 9:07 -> 17:00 rounds to 9:00 -> 17:00 = 8h, not (9:00-13:00=3.75 rounded halves summed).
      assert.equal(hours.e1[5], 8);
    });

    test('a flag on the LAST session of the day (nothing to chain to) has no effect', () => {
      const flaggedLast = {...afternoonSession, lunch_paid: true};
      const {hours} = buildDayHours([morningSession, flaggedLast], ['e1'], 15);
      assert.equal(hours.e1[5], 7);
    });

    test('a three-session day with both gaps flagged merges into a single span', () => {
      const s1 = {...morningSession, lunch_paid: true};
      const s2 = {...afternoonSession, clock_out: '2026-09-05T18:00:00.000Z', lunch_paid: true};
      const s3 = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T19:00:00.000Z', clock_out: '2026-09-05T20:00:00.000Z' };
      const {hours} = buildDayHours([s1, s2, s3], ['e1'], 15);
      assert.equal(hours.e1[5], 11); // 9:00 -> 20:00
    });

    test('flagged but the following session is still open: day reports open, not a false total', () => {
      const flagged = {...morningSession, lunch_paid: true};
      const stillOpenAfternoon = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T13:00:00.000Z', clock_out: null };
      const {hours, openFlags} = buildDayHours([flagged, stillOpenAfternoon], ['e1'], 15);
      assert.equal(hours.e1[5], null);
      assert.equal(openFlags.e1[5], true);
    });
  });
});

describe('groupByEmployeeDay', () => {
  test('sorts a day\'s sessions chronologically regardless of input order', () => {
    const afternoon = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T09:30:00.000Z', clock_out: '2026-09-05T12:00:00.000Z' };
    const morning = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T04:00:00.000Z', clock_out: '2026-09-05T08:00:00.000Z' };
    const map = groupByEmployeeDay([afternoon, morning]);
    assert.deepEqual(map.e1[5], [morning, afternoon]);
  });

  test('keeps different employees\' and different days\' sessions apart', () => {
    const a = { emp_id: 'e1', date: '2026-09-05', clock_in: '2026-09-05T09:00:00.000Z', clock_out: null };
    const b = { emp_id: 'e2', date: '2026-09-05', clock_in: '2026-09-05T09:00:00.000Z', clock_out: null };
    const c = { emp_id: 'e1', date: '2026-09-06', clock_in: '2026-09-06T09:00:00.000Z', clock_out: null };
    const map = groupByEmployeeDay([a, b, c]);
    assert.deepEqual(map.e1[5], [a]);
    assert.deepEqual(map.e2[5], [b]);
    assert.deepEqual(map.e1[6], [c]);
  });

  test('no records produces an empty map', () => {
    assert.deepEqual(groupByEmployeeDay([]), {});
  });
});

describe('needsReview', () => {
  const realIn = { clock_in: '2026-09-05T09:00:00.000Z', clock_out: '2026-09-05T13:00:00.000Z', out_photo: 'e1/a-out.jpg' };
  const autoOut = { clock_in: '2026-09-05T09:00:00.000Z', clock_out: '2026-09-05T13:00:00.000Z', out_photo: null };
  const stillOpen = { clock_in: '2026-09-05T14:00:00.000Z', clock_out: null, out_photo: null };

  test('a normally-closed single session: no review needed', () => {
    assert.equal(needsReview([realIn]), false);
  });

  test('still clocked in (forgot to clock out): needs review', () => {
    assert.equal(needsReview([stillOpen]), true);
  });

  // The actual gap this guards: an auto-closed lunch that got a real resume punch afterward is
  // resolved and fine; one that never got a follow-up session looks identical to a normal short
  // day unless the LAST session specifically is checked, not just "was anyone auto-closed today".
  test('auto-closed for lunch and never resumed (last session has no photo): needs review', () => {
    assert.equal(needsReview([autoOut]), true);
  });

  test('auto-closed for lunch but resumed afterward: no review needed', () => {
    assert.equal(needsReview([autoOut, realIn]), false);
  });

  test('no sessions that day: no review needed', () => {
    assert.equal(needsReview([]), false);
    assert.equal(needsReview(undefined), false);
  });
});

describe('dayOffStatus', () => {
  // weekday is passed in as a plain 0-6 number rather than derived from `date` internally —
  // keeps this test independent of which real calendar dates happen to fall on a Friday.
  const FRIDAY = 5, THURSDAY = 4;

  test('a Friday with no punches is the standing paid holiday', () => {
    assert.equal(dayOffStatus({date:'2026-09-11', weekday:FRIDAY, today:'2026-09-11'}), 'holiday');
  });

  test('a non-Friday with no punches is an inferred day off', () => {
    assert.equal(dayOffStatus({date:'2026-09-10', weekday:THURSDAY, today:'2026-09-11'}), 'off');
  });

  test('a day that has not happened yet has nothing to show', () => {
    assert.equal(dayOffStatus({date:'2026-09-12', weekday:FRIDAY, today:'2026-09-11'}), null);
  });

  test('today itself is eligible (not treated as "not happened yet")', () => {
    assert.equal(dayOffStatus({date:'2026-09-11', weekday:THURSDAY, today:'2026-09-11'}), 'off');
  });

  test('a day before the employee was added has nothing to show', () => {
    assert.equal(dayOffStatus({date:'2026-09-01', weekday:THURSDAY, employeeSince:'2026-09-05', today:'2026-09-11'}), null);
  });

  // The regression this guards: checking weekday before employeeSince would pay someone a
  // "holiday" for a Friday that fell before they were ever added to the system.
  test('a Friday before the employee was added: hire date wins over the holiday', () => {
    assert.equal(dayOffStatus({date:'2026-09-04', weekday:FRIDAY, employeeSince:'2026-09-05', today:'2026-09-11'}), null);
  });

  test('no employeeSince provided (e.g. demo mode has no created_at): never gated', () => {
    assert.equal(dayOffStatus({date:'2026-01-01', weekday:THURSDAY, today:'2026-09-11'}), 'off');
  });
});

describe('isHalfDay', () => {
  const morning = { clock_in: '2026-09-11T09:00:00.000Z', clock_out: '2026-09-11T13:00:00.000Z' };
  const afternoon = { clock_in: '2026-09-11T13:00:00.000Z', clock_out: '2026-09-11T17:00:00.000Z' };
  const noBreak = { clock_in: '2026-09-11T09:00:00.000Z', clock_out: '2026-09-11T18:00:00.000Z' };

  test('a single short session (4h, well under the 6h threshold) is a half day', () => {
    assert.equal(isHalfDay([morning], 4), true);
  });

  // The regression this guards: a real single-session day worked from 9-6 (9h) was showing as
  // a half day before hoursWorked was factored in — indistinguishable from someone who only
  // worked a 4h morning, purely because both are "one session."
  test('a single session with close to a full day\'s hours (worked straight through, no break) is NOT a half day', () => {
    assert.equal(isHalfDay([noBreak], 9), false);
  });

  test('a single session right at the threshold (6h, not below it) is not a half day', () => {
    assert.equal(isHalfDay([morning], 6), false);
  });

  test('a morning + afternoon pair (a full lunch-break day) is not a half day, regardless of hours', () => {
    assert.equal(isHalfDay([morning, afternoon], 8), false);
  });

  test('no sessions is not a half day', () => {
    assert.equal(isHalfDay([], 4), false);
    assert.equal(isHalfDay(undefined, 4), false);
  });

  test('hoursWorked missing (e.g. a still-open session) is not treated as a half day', () => {
    assert.equal(isHalfDay([morning], null), false);
    assert.equal(isHalfDay([morning], undefined), false);
  });
});
