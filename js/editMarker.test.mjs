// Run with: node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { editMarkerFor, addedByOwnerMarker, isMissingMarkerColumn, withoutMarker } from './editMarker.js';

const NOW = '2026-10-08T05:30:00.000Z';

describe('editMarkerFor', () => {
  test('first edit records what the kiosk captured', () => {
    const row = { clock_in: '2026-10-06T08:32:09.000Z', clock_out: '2026-10-06T18:30:00.000Z', edited_at: null };
    assert.deepEqual(editMarkerFor(row, NOW), {
      edited_at: NOW, orig_clock_in: '2026-10-06T08:32:09.000Z', orig_clock_out: '2026-10-06T18:30:00.000Z'
    });
  });

  test('an open session is remembered as open (orig_clock_out null)', () => {
    const m = editMarkerFor({ clock_in: 'x', clock_out: undefined }, NOW);
    assert.equal(m.orig_clock_out, null);
  });

  test('a second edit moves edited_at but never overwrites the kiosk originals', () => {
    const row = { clock_in: 'edited-in', clock_out: 'edited-out', edited_at: '2026-10-07T05:00:00.000Z', orig_clock_in: 'kiosk-in' };
    assert.deepEqual(editMarkerFor(row, NOW), { edited_at: NOW });
  });
});

describe('other helpers', () => {
  test('an owner-created record has edited_at and no originals', () => {
    assert.deepEqual(addedByOwnerMarker(NOW), { edited_at: NOW, orig_clock_in: null, orig_clock_out: null });
  });

  test('recognises "migration not run yet" errors, and nothing else', () => {
    assert.equal(isMissingMarkerColumn({ code: 'PGRST204', message: "Could not find the 'edited_at' column" }), true);
    assert.equal(isMissingMarkerColumn({ code: '42703', message: 'column "orig_clock_in" does not exist' }), true);
    assert.equal(isMissingMarkerColumn({ code: '23505', message: 'duplicate key' }), false);
    assert.equal(isMissingMarkerColumn(new Error('Failed to fetch')), false);
  });

  test('withoutMarker strips only the marker fields', () => {
    assert.deepEqual(
      withoutMarker({ clock_in: 'a', edited_at: 'b', orig_clock_in: 'c', orig_clock_out: 'd' }),
      { clock_in: 'a' }
    );
  });
});
