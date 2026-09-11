// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cutoffTimeFor, shouldAutoCloseForLunch } from './lunch.js';

describe('cutoffTimeFor', () => {
  test('returns today\'s configured cutoff (1:00 PM by default), same calendar day as `now`', () => {
    const now = new Date(2026, 8, 11, 9, 30); // Sep 11, 2026, 9:30 AM
    const cutoff = cutoffTimeFor(now);
    assert.equal(cutoff.getFullYear(), 2026);
    assert.equal(cutoff.getMonth(), 8);
    assert.equal(cutoff.getDate(), 11);
    assert.equal(cutoff.getHours(), 13);
    assert.equal(cutoff.getMinutes(), 0);
  });
});

describe('shouldAutoCloseForLunch', () => {
  const openMorningSession = { clock_in: new Date(2026, 8, 11, 9, 0).toISOString(), clock_out: null };

  test('still open, clocked in before cutoff, now past cutoff -> true', () => {
    const now = new Date(2026, 8, 11, 13, 5);
    assert.equal(shouldAutoCloseForLunch(openMorningSession, now), true);
  });

  test('now not yet at the cutoff -> false', () => {
    const now = new Date(2026, 8, 11, 12, 59);
    assert.equal(shouldAutoCloseForLunch(openMorningSession, now), false);
  });

  test('already closed -> false regardless of time', () => {
    const closed = { clock_in: openMorningSession.clock_in, clock_out: new Date(2026, 8, 11, 12, 0).toISOString() };
    const now = new Date(2026, 8, 11, 18, 0);
    assert.equal(shouldAutoCloseForLunch(closed, now), false);
  });

  test('a stale session left open from a prior day is not force-closed today', () => {
    const yesterday = { clock_in: new Date(2026, 8, 10, 9, 0).toISOString(), clock_out: null };
    const now = new Date(2026, 8, 11, 13, 5);
    assert.equal(shouldAutoCloseForLunch(yesterday, now), false);
  });

  test('a session that started after the cutoff (e.g. a 2pm shift) is never auto-closed', () => {
    const afternoonStart = { clock_in: new Date(2026, 8, 11, 14, 0).toISOString(), clock_out: null };
    const now = new Date(2026, 8, 11, 18, 0);
    assert.equal(shouldAutoCloseForLunch(afternoonStart, now), false);
  });

  test('no record -> false', () => {
    assert.equal(shouldAutoCloseForLunch(null, new Date(2026, 8, 11, 13, 5)), false);
  });
});
