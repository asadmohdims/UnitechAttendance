// Run with: node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryTimes, CLOCK_OUT_BEFORE_IN } from './timeEntry.js';

const DATE = '2026-10-06';
const local = (h, m, s = 0, ms = 0) => { const d = new Date(DATE + 'T00:00:00'); d.setHours(h, m, s, ms); return d; };

describe('buildEntryTimes: the guard', () => {
  test('REGRESSION (Shakib, Oct 6): 4:35 for a 2:02 PM session is refused, not wrapped to 4:35 AM next day', () => {
    const r = buildEntryTimes(DATE, '14:02', '04:35');
    assert.equal(r.error, CLOCK_OUT_BEFORE_IN);
    assert.equal(r.inIso, undefined);
  });

  test('clock-out equal to clock-in is refused', () => {
    assert.equal(buildEntryTimes(DATE, '14:02', '14:02').error, CLOCK_OUT_BEFORE_IN);
  });

  test('a clock-out the same evening is accepted', () => {
    const r = buildEntryTimes(DATE, '14:02', '16:35');
    assert.equal(r.error, undefined);
    assert.equal(r.inIso, local(14, 2).toISOString());
    assert.equal(r.outIso, local(16, 35).toISOString());
    assert.equal(r.changed, true);
  });

  test('an empty clock-out means still open', () => {
    const r = buildEntryTimes(DATE, '14:02', '');
    assert.equal(r.outIso, null);
    assert.equal(r.error, undefined);
  });

  test('garbage or out-of-range times are refused', () => {
    assert.ok(buildEntryTimes(DATE, '', '16:00').error);
    assert.ok(buildEntryTimes(DATE, '25:00', '').error);
    assert.ok(buildEntryTimes(DATE, '14:61', '').error);
    assert.ok(buildEntryTimes(DATE, '14:02', 'abc').error);
  });
});

describe('buildEntryTimes: precision is preserved', () => {
  const existing = { clock_in: local(14, 2, 9, 412).toISOString(), clock_out: local(18, 1, 17, 88).toISOString() };

  test('saving with nothing changed reports no change and keeps the exact stored seconds', () => {
    const r = buildEntryTimes(DATE, '14:02', '18:01', existing);
    assert.equal(r.changed, false);
    assert.equal(r.inIso, existing.clock_in);
    assert.equal(r.outIso, existing.clock_out);
  });

  test('changing only the clock-out leaves the clock-in at its exact stored instant', () => {
    const r = buildEntryTimes(DATE, '14:02', '18:30', existing);
    assert.equal(r.changed, true);
    assert.equal(r.inIso, existing.clock_in);
    assert.equal(r.outIso, local(18, 30).toISOString());
  });

  test('a stored next-day 4:35 AM is NOT mistaken for an unchanged "04:35": it must be corrected', () => {
    const wrapped = { clock_in: local(14, 2).toISOString(), clock_out: new Date(local(4, 35).getTime() + 86400000).toISOString() };
    // the dialog pre-fills "04:35"; saving that as-is hits the guard instead of passing through
    assert.equal(buildEntryTimes(DATE, '14:02', '04:35', wrapped).error, CLOCK_OUT_BEFORE_IN);
    assert.equal(buildEntryTimes(DATE, '14:02', '16:35', wrapped).changed, true);
  });

  test('reopening a closed session (clearing the clock-out) counts as a change', () => {
    const r = buildEntryTimes(DATE, '14:02', '', existing);
    assert.equal(r.outIso, null);
    assert.equal(r.changed, true);
  });
});
