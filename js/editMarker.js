// Pure: what gets recorded on a `records` row when the OWNER (not the kiosk) changes its times, so
// the app never amends a punch silently. Columns (all nullable, additive — see supabase-setup.sql):
//   edited_at       when the owner last changed or added this record
//   orig_clock_in   what the kiosk captured, saved on the FIRST edit only
//   orig_clock_out  likewise (null if the session was still open)
// A record the owner created from scratch has edited_at but no orig_* — "added by owner".
// Nothing here guesses at history: rows edited before this existed have no marker and show none.

// The fields to merge into an update. A second edit moves edited_at but never overwrites orig_*,
// so the kiosk's own times are always what the first edit found.
export function editMarkerFor(row, nowIso){
  if(row.edited_at) return {edited_at: nowIso};
  return {edited_at: nowIso, orig_clock_in: row.clock_in, orig_clock_out: row.clock_out ?? null};
}

export function addedByOwnerMarker(nowIso){
  return {edited_at: nowIso, orig_clock_in: null, orig_clock_out: null};
}

// True when PostgREST/Postgres rejected a write because the migration adding these columns hasn't
// been run yet. The caller then retries WITHOUT the marker so the edit itself still saves — a
// missing migration must never block fixing a time, and never drops one.
export function isMissingMarkerColumn(err){
  const text = `${err?.code || ''} ${err?.message || ''}`;
  return /PGRST204|42703/.test(text) || /edited_at|orig_clock_(in|out)/.test(text);
}

export const MARKER_FIELDS = ['edited_at', 'orig_clock_in', 'orig_clock_out'];

export function withoutMarker(fields){
  const copy = {...fields};
  MARKER_FIELDS.forEach(k => delete copy[k]);
  return copy;
}
