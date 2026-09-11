// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roundToQuarterHour, recHoursRounded, wasRounded } from './rounding.js';

describe('roundToQuarterHour', () => {
  test('exactly on a quarter hour stays put', () => {
    const d = roundToQuarterHour(new Date(2026, 8, 11, 9, 0, 0));
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 0);
  });

  test('1-10 minutes past a quarter rounds down (the shop\'s grace window)', () => {
    [1, 7, 10].forEach(min => {
      const d = roundToQuarterHour(new Date(2026, 8, 11, 9, min, 0));
      assert.equal(d.getHours(), 9, `minute ${min}`);
      assert.equal(d.getMinutes(), 0, `minute ${min}`);
    });
  });

  test('11-14 minutes past a quarter rounds up', () => {
    [11, 12, 14].forEach(min => {
      const d = roundToQuarterHour(new Date(2026, 8, 11, 9, min, 0));
      assert.equal(d.getHours(), 9, `minute ${min}`);
      assert.equal(d.getMinutes(), 15, `minute ${min}`);
    });
  });

  test('exact 10:30 cutover rounds down, 10:31 rounds up', () => {
    const down = roundToQuarterHour(new Date(2026, 8, 11, 9, 10, 30));
    assert.equal(down.getHours(), 9);
    assert.equal(down.getMinutes(), 0);
    const up = roundToQuarterHour(new Date(2026, 8, 11, 9, 10, 31));
    assert.equal(up.getHours(), 9);
    assert.equal(up.getMinutes(), 15);
  });

  test('rounds up across an hour boundary (9:56 -> 10:00)', () => {
    const d = roundToQuarterHour(new Date(2026, 8, 11, 9, 56, 0));
    assert.equal(d.getHours(), 10);
    assert.equal(d.getMinutes(), 0);
  });

  test('9:53 stays within the grace window and rounds down (9:53 -> 9:45)', () => {
    const d = roundToQuarterHour(new Date(2026, 8, 11, 9, 53, 0));
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 45);
  });

  test('rounds up across a day boundary (11:56 PM -> next day midnight)', () => {
    const d = roundToQuarterHour(new Date(2026, 8, 11, 23, 56, 0));
    assert.equal(d.getDate(), 12);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });
});

describe('wasRounded', () => {
  test('false when already on a quarter hour', () => {
    assert.equal(wasRounded(new Date(2026, 8, 11, 9, 0, 0).toISOString()), false);
  });

  test('true when the punch lands off a quarter hour', () => {
    assert.equal(wasRounded(new Date(2026, 8, 11, 9, 11, 0).toISOString()), true);
  });
});

describe('recHoursRounded', () => {
  test('rounds both punches before diffing (9:11 -> 9:15, 12:53 -> 12:45 => 3h30m)', () => {
    const r = {
      clock_in: new Date(2026, 8, 11, 9, 11, 0).toISOString(),
      clock_out: new Date(2026, 8, 11, 12, 53, 0).toISOString()
    };
    assert.equal(recHoursRounded(r), 3.5);
  });

  test('open session (no clock_out) -> null', () => {
    assert.equal(recHoursRounded({ clock_in: new Date().toISOString(), clock_out: null }), null);
  });

  test('a short session entirely inside the grace window rounds to 0, not negative', () => {
    const r = {
      clock_in: new Date(2026, 8, 11, 9, 7, 0).toISOString(),  // rounds down to 9:00
      clock_out: new Date(2026, 8, 11, 9, 9, 0).toISOString()  // rounds down to 9:00
    };
    assert.equal(recHoursRounded(r), 0);
  });
});
