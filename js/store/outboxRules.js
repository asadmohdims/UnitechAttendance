// Pure rules for what the sync does to an outbox row after talking to the server. No IndexedDB,
// no network, no DOM — same pattern as punchCooldown.js, so the decisions that used to cause a
// lost update can be unit-tested directly.
//
// Background: the outbox row is the ONLY copy of a punch until it syncs. Sync used to read a row,
// send it (seconds, on bad Wi-Fi), then write that same old copy back — so a clock-out tapped
// during the send was silently overwritten by the stale open row. Now every local change bumps
// `rev` (an optimistic lock, like a JPA @Version), sync records which `rev` it sent, and after the
// send it only applies its result if the row still has that `rev`. Each function here takes the
// CURRENT row (read inside the same IndexedDB transaction that writes the result, see
// outbox.update) and returns what to store: a new row, `undefined` (leave it alone) or DELETE.

export const DELETE = Symbol('delete outbox row');

// Rows written before `rev` existed have none: treat as 0, which never equals "never synced" (-1),
// so they are sent once more with the same idempotent upsert and then carry the fields normally.
export const revOf = row => row.rev ?? 0;

export function hasPendingPhoto(row){
  return !!row.in_photo_blob || (!!row.clock_out && !!row.out_photo_blob);
}

// True when the server may be behind this row. A synced open session (clocked in, not out) is
// just local bookkeeping and is NOT re-sent every 30s any more — only a real change makes it dirty.
export function needsSync(row){
  return revOf(row) !== (row.syncedRev ?? -1) || hasPendingPhoto(row);
}

// The server accepted the version with `sentRev`. If the row is still that version it is either
// finished (closed -> remove) or now in step with the server (open -> remember which version).
// If it moved on while the request was in flight (a tap, an edit), keep the newer row as it is:
// it stays dirty and goes out on the next pass. Never delete a row still holding an un-uploaded photo.
export function applySyncSuccess(cur, sentRev){
  const settled = {...cur, attempts: 0, last_error: null};
  if(revOf(cur) !== sentRev) return settled;
  if(cur.clock_out && !hasPendingPhoto(cur)) return DELETE;
  return {...settled, syncedRev: sentRev};
}

// Clears only the blob that was just uploaded, and only if the row still points at that path —
// a row that has since been given a different photo keeps its new blob.
export function applyPhotoUploaded(cur, which, path){
  if(which === 'in' && cur.in_photo === path) return {...cur, in_photo_blob: null};
  if(which === 'out' && cur.out_photo === path) return {...cur, out_photo_blob: null};
  return undefined;
}

// Bookkeeping only; the punch itself is never touched by a failure. `renewing` = the request was
// refused locally because the sign-in is mid-renewal (js/signedOutGuard.js), which is not this
// row's fault and must not count toward "stuck".
export function applySyncFailure(cur, err, renewing){
  return {
    ...cur,
    attempts: renewing ? (cur.attempts || 0) : (cur.attempts || 0) + 1,
    last_error: String((err && err.message) || err)
  };
}

// Whether the server could already hold this row. Only a row that completed a sync (or was
// created from a server record) can; a never-synced row can be deleted locally with no network.
export function existsOnServer(row){
  return row.syncedRev !== undefined || !!row.remoteClose;
}
