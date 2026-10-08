// Run with: node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETE, revOf, needsSync, applySyncSuccess, applyPhotoUploaded, applySyncFailure, existsOnServer
} from './outboxRules.js';

const openRow = (over = {}) => ({
  clientId: 'r1', emp_id: 'e1', clock_in: '2026-10-07T08:45:09.000Z', clock_out: null,
  in_photo: 'e1/r1-in.jpg', out_photo: null, in_photo_blob: null, out_photo_blob: null,
  rev: 1, attempts: 0, last_error: null, ...over
});

describe('needsSync', () => {
  test('a brand-new row (never synced) is dirty', () => {
    assert.equal(needsSync(openRow()), true);
  });

  test('an open row that already synced at its current rev is NOT re-sent', () => {
    assert.equal(needsSync(openRow({ syncedRev: 1 })), false);
  });

  test('any local change after the sync makes it dirty again', () => {
    assert.equal(needsSync(openRow({ rev: 2, syncedRev: 1 })), true);
  });

  test('a legacy row with no rev/syncedRev is dirty once, then settles', () => {
    const legacy = { clientId: 'old', clock_in: 'x', clock_out: null };
    assert.equal(revOf(legacy), 0);
    assert.equal(needsSync(legacy), true);
    const settled = applySyncSuccess(legacy, revOf(legacy));
    assert.equal(settled.syncedRev, 0);
    assert.equal(needsSync(settled), false);
  });

  test('an un-uploaded photo keeps a row dirty even if the rev matches', () => {
    assert.equal(needsSync(openRow({ syncedRev: 1, in_photo_blob: {} })), true);
    // an out blob only counts once there is a clock-out for it to belong to
    assert.equal(needsSync(openRow({ syncedRev: 1, out_photo_blob: {} })), false);
    assert.equal(needsSync(openRow({ syncedRev: 1, clock_out: 't', out_photo_blob: {} })), true);
  });
});

describe('applySyncSuccess', () => {
  test('REPLAY OF THE INCIDENT: a clock-out tapped while the open row was in flight survives', () => {
    // Sync snapshots the open row (rev 1) and starts the request...
    const sentRev = 1;
    // ...the employee taps out: the row is now closed, rev 2, with its photo blob.
    const tapped = openRow({
      rev: 2, clock_out: '2026-10-07T12:31:17.000Z',
      out_photo: 'e1/r1-out.jpg', out_photo_blob: { fake: 'blob' }
    });
    // ...then the request for the OLD open row finishes.
    const result = applySyncSuccess(tapped, sentRev);
    assert.notEqual(result, DELETE);
    assert.equal(result.clock_out, '2026-10-07T12:31:17.000Z');
    assert.deepEqual(result.out_photo_blob, { fake: 'blob' });
    assert.equal(result.out_photo, 'e1/r1-out.jpg');
    assert.equal(needsSync(result), true, 'the closed version must still be sent');
    assert.equal(result.syncedRev, undefined, 'must not claim the server has the newer version');
  });

  test('an unchanged closed row is removed once the server has it', () => {
    assert.equal(applySyncSuccess(openRow({ rev: 3, clock_out: 't' }), 3), DELETE);
  });

  test('a closed row is never removed while it still holds an un-uploaded photo', () => {
    const r = applySyncSuccess(openRow({ rev: 3, clock_out: 't', out_photo_blob: {} }), 3);
    assert.notEqual(r, DELETE);
  });

  test('an unchanged open row is marked in step with the server and failure bookkeeping is cleared', () => {
    const r = applySyncSuccess(openRow({ attempts: 2, last_error: 'boom' }), 1);
    assert.equal(r.syncedRev, 1);
    assert.equal(r.attempts, 0);
    assert.equal(r.last_error, null);
  });

  test('an edit made while the request was in flight is kept and stays dirty', () => {
    const edited = openRow({ rev: 2, syncedRev: undefined, clock_in: '2026-10-07T08:30:00.000Z' });
    const r = applySyncSuccess(edited, 1);
    assert.equal(r.clock_in, '2026-10-07T08:30:00.000Z');
    assert.equal(needsSync(r), true);
  });
});

describe('applyPhotoUploaded', () => {
  test('clears only the blob that was uploaded', () => {
    const row = openRow({ in_photo_blob: { a: 1 }, clock_out: 't', out_photo: 'p-out', out_photo_blob: { b: 2 } });
    const r = applyPhotoUploaded(row, 'in', 'e1/r1-in.jpg');
    assert.equal(r.in_photo_blob, null);
    assert.deepEqual(r.out_photo_blob, { b: 2 });
  });

  test('leaves the row alone if it now points at a different photo path', () => {
    const row = openRow({ clock_out: 't', out_photo: 'new-path', out_photo_blob: { b: 2 } });
    assert.equal(applyPhotoUploaded(row, 'out', 'old-path'), undefined);
  });
});

describe('applySyncFailure', () => {
  test('counts an attempt and keeps the punch untouched', () => {
    const row = openRow({ clock_out: 't', out_photo_blob: { b: 2 } });
    const r = applySyncFailure(row, new Error('503'), false);
    assert.equal(r.attempts, 1);
    assert.equal(r.last_error, '503');
    assert.equal(r.clock_out, 't');
    assert.deepEqual(r.out_photo_blob, { b: 2 });
  });

  test('a sign-in renewal refusal does not count toward "stuck"', () => {
    const r = applySyncFailure(openRow({ attempts: 1 }), new Error('401'), true);
    assert.equal(r.attempts, 1);
    assert.equal(r.last_error, '401');
  });
});

describe('existsOnServer', () => {
  test('a never-synced row can be deleted locally, offline', () => {
    assert.equal(existsOnServer(openRow()), false);
  });
  test('a row that has synced, or is a queued close for a server session, has a server copy', () => {
    assert.equal(existsOnServer(openRow({ syncedRev: 1 })), true);
    assert.equal(existsOnServer(openRow({ remoteClose: true })), true);
  });
});
