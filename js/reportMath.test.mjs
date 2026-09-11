// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDayHours } from './reportMath.js';

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
});
