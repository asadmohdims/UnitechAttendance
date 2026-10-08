// Supabase-backed implementation of the store interface, used when DEMO_MODE is false.
// Every network call here goes through withTimeout() (js/supabaseClient.js) — nothing may leave
// the UI waiting indefinitely on a bad connection.
import { sb, withTimeout, FAST_READ_TIMEOUT_MS, REQUEST_TIMEOUT_MS, hasPersistedSession, onSignInRestored } from '../supabaseClient.js';
import { isSignedOutBlock, keepCachedRoster } from '../signedOutGuard.js';
import { dateStr } from '../utils.js';
import { DEMO_MODE } from '../config.js';
import * as outbox from './outbox.js';
import { editMarkerFor, addedByOwnerMarker, isMissingMarkerColumn, withoutMarker } from '../editMarker.js';
import { needsSync, revOf, applySyncSuccess, applyPhotoUploaded, applySyncFailure, existsOnServer } from './outboxRules.js';

const EMP_CACHE_KEY = 'attendance_employee_cache';

// For reads that have a local fallback (the kiosk's roster, open sessions, today's punches):
// returns the server's rows, or throws so the caller falls back to local data. Two cases fall
// back instead of trusting the server:
//  - Slow or no network: give up after `ms` rather than waiting (3s by default for the kiosk;
//    waiting on the network is exactly what these fallbacks exist to avoid).
//  - Signed out: every table is "authenticated only", and with no session Postgres row-level
//    security doesn't return an error, it returns zero rows. Trusting that would overwrite the
//    offline roster cache with [] and show everyone as not clocked in. supabase-js drops the
//    session if the server definitively rejects a token refresh, and nothing else notices.
//    (A session that's saved but mid-renewal is caught one layer down: js/signedOutGuard.js
//    refuses the request itself, which lands in the same fallback.)
async function readWithFallback(query, ms = FAST_READ_TIMEOUT_MS){
  if(!hasPersistedSession()) throw new Error('Signed out on this device');
  const {data, error} = await withTimeout(query, ms);
  if(error) throw error;
  return data;
}

// Public record shape (no blob fields) for an outbox row that hasn't synced yet.
function toRecordShape(rec){
  return {id:rec.clientId, emp_id:rec.emp_id, date:rec.date, clock_in:rec.clock_in,
    clock_out:rec.clock_out, in_photo:rec.in_photo, out_photo:rec.out_photo,
    lunch_paid:rec.lunch_paid || false, created_at:rec.created_at,
    edited_at:rec.edited_at || null, orig_clock_in:rec.orig_clock_in || null, orig_clock_out:rec.orig_clock_out || null};
}

// An outbox row this tablet owns and can edit locally: a punch it created that's still open
// or not yet synced. A `remoteClose` row (see clockOut) is only a queued close for a session the
// server owns, so edits to that session go straight to Postgres like any other server record.
async function getOwnedLocalRow(recordId){
  const rec = await outbox.getItem(recordId);
  return rec && !rec.remoteClose ? rec : null;
}

async function listEmployees(){
  try{
    const data = await readWithFallback(sb.from('employees').select('*').order('created_at'));
    const cached = JSON.parse(localStorage.getItem(EMP_CACHE_KEY) || 'null');
    if(keepCachedRoster(data, cached)){
      console.warn('Server returned an empty roster after a real one was seen — keeping the saved roster.');
      return cached;
    }
    localStorage.setItem(EMP_CACHE_KEY, JSON.stringify(data));
    return data;
  }catch(err){
    // Offline on a cold load (device reboot, browser crash): serve the last known
    // roster instead of an empty grid — nobody should be unable to punch at all
    // just because the kiosk happened to reload while Wi-Fi was down.
    const cached = localStorage.getItem(EMP_CACHE_KEY);
    if(cached) return JSON.parse(cached);
    throw err;
  }
}

async function listOpenSessions(){
  const openSessions = {};
  try{
    const data = await readWithFallback(sb.from('records').select('*').is('clock_out', null));
    data.forEach(r => openSessions[r.emp_id] = r);
  }catch(err){ /* offline — fall through with whatever the outbox has */ }
  // Local wins, same as listRecordsForDate: a session closed on this tablet but not synced yet
  // is still open on the server, and must not come back as "Working since… tap to finish".
  (await outbox.getAllItems()).forEach(r => {
    if(!r.clock_out) openSessions[r.emp_id] = toRecordShape(r);
    else if(openSessions[r.emp_id]?.id === r.clientId) delete openSessions[r.emp_id];
  });
  return openSessions;
}

async function addEmployee(name){
  const {data, error} = await withTimeout(sb.from('employees').insert({name}).select().single());
  if(error) throw error;
  return data;
}

async function renameEmployee(id, name){
  const {error} = await withTimeout(sb.from('employees').update({name}).eq('id', id));
  if(error) throw error;
}

async function setEmployeeActive(id, active){
  const {error} = await withTimeout(sb.from('employees').update({active}).eq('id', id));
  if(error) throw error;
}

async function setEmployeeAvatar(id, path){
  const {error} = await withTimeout(sb.from('employees').update({avatar:path}).eq('id', id));
  if(error) throw error;
}

// Owner-assigned PIN for this employee's own kiosk access to Payments — stored as a hash+salt
// pair (see js/pin.js), never the raw PIN. Needs the `pin_hash`/`pin_salt` columns added to
// `employees` (see supabase-setup.sql).
async function setEmployeePin(id, hash, salt){
  const {error} = await withTimeout(sb.from('employees').update({pin_hash:hash, pin_salt:salt}).eq('id', id));
  if(error) throw error;
}

async function getEmployeePinRecord(id){
  const {data, error} = await withTimeout(sb.from('employees').select('pin_hash,pin_salt').eq('id', id).single());
  if(error) throw error;
  return data.pin_hash ? {hash:data.pin_hash, salt:data.pin_salt} : null;
}

// A client-generated UUID becomes both the local outbox key AND the eventual Postgres
// records.id (it overrides the column's `default gen_random_uuid()` on upsert). There's
// no separate "temp id -> real id" step: the same id is used from the tap onward, synced
// or not, so clockOut/edit/delete all just work whether or not the clock-in has reached
// Supabase yet.
async function clockIn(empId, blob){
  const clientId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const rec = {
    clientId, emp_id:empId, date:dateStr(), clock_in:nowIso, clock_out:null,
    in_photo:`${empId}/${clientId}-in.jpg`, out_photo:null,
    in_photo_blob:blob, out_photo_blob:null,
    rev:1, // optimistic-lock counter, see outboxRules.js; no syncedRev yet = never sent
    attempts:0, last_error:null, created_at:nowIso
  };
  await outbox.putItem(rec); // durable local write — this IS the "instant" part, no network involved
  outbox.kick();
  return toRecordShape(rec);
}

// Takes the whole open-session record (from state.openSessions), not just its id, so a session
// this tablet doesn't have locally can still be closed with no network (the remote branch
// below). `atIso` lets a caller record an exact past instant (e.g. the stale-session midnight
// close) instead of "now". `blob` is optional: an auto-close has nobody at the camera, so
// out_photo/out_photo_blob are only set when a real photo was actually captured — otherwise
// we'd leave a photo path pointing at nothing ever uploaded.
async function clockOut(record, blob, atIso){
  const closedAt = atIso || new Date().toISOString();
  // One atomic read-modify-write: a sync that is mid-flight on this same row can no longer write a
  // stale open copy over the clock-out (see outbox.update).
  const {status} = await outbox.update(record.id, rec => {
    if(rec.clock_out) throw new Error('This session was already clocked out.');
    const next = {...rec, clock_out: closedAt};
    if(blob){
      next.out_photo = `${rec.emp_id}/${rec.clientId}-out.jpg`;
      next.out_photo_blob = blob;
    }
    return next;
  });
  if(status !== 'missing'){
    outbox.kick();
    return;
  }

  // Not in this tablet's outbox: the session was opened somewhere else (another device, or the
  // admin's "Add missed punch" with the clock-out left empty), or this browser's copy is gone.
  // This used to write straight to Postgres, so it was the one punch that needed the network
  // right then. Now it's queued like any other punch. It's marked `remoteClose` because the
  // server owns this row: sync may only *close* it, and only if it's still open there (see
  // syncRemoteClose), never rewrite it from this possibly stale copy. The photo gets its own
  // unique name so it can never overwrite a photo another device already saved for this session.
  await outbox.putItem({
    clientId:record.id, emp_id:record.emp_id, date:record.date,
    clock_in:record.clock_in, clock_out:closedAt,
    in_photo:record.in_photo, out_photo:blob ? `${record.emp_id}/${record.id}-out-${crypto.randomUUID().slice(0, 8)}.jpg` : null,
    in_photo_blob:null, out_photo_blob:blob || null,
    lunch_paid:record.lunch_paid || false,
    rev:1,
    attempts:0, last_error:null, created_at:record.created_at,
    remoteClose:true
  });
  outbox.kick();
}

// Admin-entered backfill for a day with no punch at all (an absence turning out to be a missed
// punch, not a genuine no-show) — same "admin desktop edit, write straight to Postgres" category
// as updateRecordTimes/setLunchPaid below, not a kiosk punch, so it never touches the outbox
// (there's no offline-tablet scenario to protect here — this is typed in from the admin panel).
async function addManualRecord(empId, date, clockInIso, clockOutIso){
  const base = {emp_id:empId, date, clock_in:clockInIso, clock_out:clockOutIso, in_photo:null, out_photo:null};
  const attempt = fields => withTimeout(sb.from('records').insert(fields).select().single());
  let {data, error} = await attempt({...base, ...addedByOwnerMarker(new Date().toISOString())});
  if(error && isMissingMarkerColumn(error)) ({data, error} = await attempt(base));
  if(error) throw error;
  return data;
}

async function listRecordsForDate(date){
  let serverRows = [];
  try{
    serverRows = await readWithFallback(sb.from('records').select('*').eq('date', date).order('clock_in'));
  }catch(err){ /* offline — serve what's local */ }
  const merged = new Map(serverRows.map(r => [r.id, r]));
  (await outbox.getAllItems()).filter(r => r.date === date)
    .forEach(r => merged.set(r.clientId, toRecordShape(r))); // local wins — it's the only copy while unsynced
  return Array.from(merged.values()).sort((a, b) => new Date(a.clock_in) - new Date(b.clock_in));
}

// Admin-only (Report, Salary), so it gets the normal time limit rather than the kiosk's fast
// one: a month of records can legitimately take more than 3s on a slow connection, and failing
// over early would quietly show a Report missing most of its data.
async function listRecordsForRange(startDate, endDate){
  let serverRows = [];
  try{
    serverRows = await readWithFallback(sb.from('records').select('*').gte('date', startDate).lte('date', endDate), REQUEST_TIMEOUT_MS);
  }catch(err){ /* offline — serve what's local */ }
  const merged = new Map(serverRows.map(r => [r.id, r]));
  (await outbox.getAllItems()).filter(r => r.date >= startDate && r.date <= endDate)
    .forEach(r => merged.set(r.clientId, toRecordShape(r)));
  return Array.from(merged.values());
}

// Edits a row this tablet still holds, atomically. A `remoteClose` row is only a queued close for a
// session the server owns (see getOwnedLocalRow), so it is left alone and the caller writes to
// Postgres instead. Returns true if the local row was changed.
async function updateOwnedLocalRow(recordId, change){
  const {status} = await outbox.update(recordId, rec => rec.remoteClose ? undefined : change(rec));
  if(status === 'updated') outbox.kick();
  return status === 'updated';
}

// An owner edit of a record's times. Besides the new times it records THAT it was edited and what
// the kiosk had captured (js/editMarker.js), so the app never amends a punch silently. The marker
// is best-effort: if the migration adding its columns hasn't been run, the edit itself still saves.
async function updateRecordTimes(recordId, clockInIso, clockOutIsoOrNull){
  const editedAt = new Date().toISOString();
  const times = {clock_in:clockInIso, clock_out:clockOutIsoOrNull};
  if(await updateOwnedLocalRow(recordId, rec => ({...rec, ...times, ...editMarkerFor(rec, editedAt)}))) return;

  // The server owns this row: read what it holds now so a first edit can keep the kiosk's times.
  let marker = {};
  try{
    const {data: current, error: readError} = await withTimeout(sb.from('records')
      .select('clock_in,clock_out,edited_at').eq('id', recordId).maybeSingle());
    if(readError) throw readError;
    if(current) marker = editMarkerFor(current, editedAt);
  }catch(err){
    if(!isMissingMarkerColumn(err)) throw err;
    console.warn('Edit marker columns missing (run the edited_at migration); saving the edit without one.');
  }
  let {error} = await withTimeout(sb.from('records').update({...times, ...marker}).eq('id', recordId));
  if(error && isMissingMarkerColumn(error)){
    ({error} = await withTimeout(sb.from('records').update(times).eq('id', recordId)));
  }
  if(error) throw error;
}

// Marks (or un-marks) the lunch gap right after this session as paid work — a reversible flag,
// never a data change to the punches themselves, so toggling it off undoes it completely.
// Needs the `lunch_paid boolean default false` column added to `records` (see supabase-setup.sql).
async function setLunchPaid(recordId, paid){
  if(await updateOwnedLocalRow(recordId, rec => ({...rec, lunch_paid:paid}))) return;
  const {error} = await withTimeout(sb.from('records').update({lunch_paid:paid}).eq('id', recordId));
  if(error) throw error;
}

// Splits one continuous session into two around a lunch gap — the original record becomes the
// morning half (its real in_photo, but no out_photo — the split point itself was never
// photographed) and a new record covers the afternoon half, carrying the ORIGINAL out_photo/
// out_photo_blob (the one real "end of day" photo, moved rather than duplicated or lost) so
// the day's last session still keeps a genuine out_photo. Defaults lunch_paid: false on the
// morning half — same as every other path that creates a lunch gap (a normal clock-out, the
// auto-close safety net): an earlier version of this defaulted to true "so splitting doesn't
// change total pay", but that fought the actual common case (see isPossibleMissedLunch() in
// reportMath.js) — an owner reaching for Split for lunch almost always means "this gap should be
// unpaid", and had to immediately undo the default every time. Still one tap to flip via the
// "Pay this" toggle (js/ui/records.js) if a split really was just cosmetic and pay shouldn't
// change.
async function splitSessionForLunch(recordId, lunchStartIso, lunchEndIso){
  const rec = await getOwnedLocalRow(recordId);
  if(rec){
    const afternoon = {
      clientId: crypto.randomUUID(), emp_id: rec.emp_id, date: rec.date,
      clock_in: lunchEndIso, clock_out: rec.clock_out,
      in_photo: null, out_photo: rec.out_photo,
      in_photo_blob: null, out_photo_blob: rec.out_photo_blob,
      rev: 1, attempts: 0, last_error: null, created_at: new Date().toISOString(), lunch_paid: false
    };
    // Afternoon first, then shorten the morning: if the page dies between the two writes the worst
    // case is a duplicated afternoon the owner can see and delete, never a lost end-of-day punch
    // and its photo (the old order could drop the afternoon entirely).
    await outbox.putItem(afternoon);
    const shortened = await updateOwnedLocalRow(recordId, cur => ({
      ...cur, clock_out: lunchStartIso, out_photo: null, out_photo_blob: null, lunch_paid: false
    }));
    if(!shortened){
      // The morning row finished syncing (and left the outbox) while the afternoon was being
      // written, so the server owns it now: shorten it there, like the not-local branch below.
      const {error} = await withTimeout(sb.from('records')
        .update({clock_out: lunchStartIso, out_photo: null, lunch_paid: false}).eq('id', recordId));
      if(error) throw error;
    }
    outbox.kick();
    return;
  }

  // Not in this browser's local outbox — same "write straight to Postgres" fallback
  // updateRecordTimes/setLunchPaid/deleteRecord already use for this case.
  const {data: existing, error: fetchError} = await withTimeout(sb.from('records').select('*').eq('id', recordId).maybeSingle());
  if(fetchError) throw fetchError;
  if(!existing) throw new Error('This session could not be found — it may have already been edited or deleted from the admin panel.');
  const {error: insertError} = await withTimeout(sb.from('records').insert({
    emp_id: existing.emp_id, date: existing.date,
    clock_in: lunchEndIso, clock_out: existing.clock_out,
    in_photo: null, out_photo: existing.out_photo, lunch_paid: false
  }));
  if(insertError) throw insertError;
  const {error: updateError} = await withTimeout(sb.from('records')
    .update({clock_out: lunchStartIso, out_photo: null, lunch_paid: false})
    .eq('id', recordId));
  if(updateError) throw updateError;
}

async function deleteRecord(record){
  const rec = await getOwnedLocalRow(record.id);
  if(rec){
    // A still-open session that has already synced exists on the server too. Dropping only the
    // local copy used to leave that row behind, and it came straight back as a clockable session.
    // A row that never synced has no server copy, so that case still works with no network.
    if(existsOnServer(rec)){
      const {error} = await withTimeout(sb.from('records').delete().eq('id', record.id));
      if(error) throw error;
      sb.storage.from('photos').remove([rec.in_photo, rec.out_photo].filter(Boolean));
    }
    await outbox.deleteItem(record.id);
    return;
  }
  const {error} = await withTimeout(sb.from('records').delete().eq('id', record.id));
  if(error) throw error;
  // A clock-out queued on this tablet for the session just deleted is moot now.
  await outbox.deleteItem(record.id);
  sb.storage.from('photos').remove([record.in_photo, record.out_photo].filter(Boolean));
}

async function listSalaryRates(empId){
  const {data, error} = await withTimeout(sb.from('salary_rates').select('*').eq('emp_id', empId).order('effective_from', {ascending:false}));
  if(error) throw error;
  return data;
}

async function setSalaryRate(empId, {monthlySalary, effectiveFrom, note}){
  const {data, error} = await withTimeout(sb.from('salary_rates')
    .insert({emp_id:empId, monthly_salary:monthlySalary, effective_from:effectiveFrom, note:note || null})
    .select().single());
  if(error) throw error;
  return data;
}

async function listDayPayOverrides(fromDate, toDate){
  const {data, error} = await withTimeout(sb.from('day_pay_overrides').select('*').gte('date', fromDate).lte('date', toDate));
  if(error) throw error;
  return data;
}

// Marks (or restores) a specific no-punch day's pay for an employee — e.g. docking a paid
// Friday holiday the owner doesn't want to pay through this month. Same reversible-flag shape
// as setLunchPaid, just keyed by (emp_id, date) via upsert since a no-punch day has no records
// row to attach a flag to. Needs the `day_pay_overrides` table added (see supabase-setup.sql).
async function setDayOverride(empId, date, paid){
  const {error} = await withTimeout(sb.from('day_pay_overrides')
    .upsert({emp_id:empId, date, paid}, {onConflict:'emp_id,date'}));
  if(error) throw error;
}

// A deliberate, occasional action (not a rapid repeated tap like clock in/out), so a plain
// write is enough — no outbox needed the way punches need one for instant latency + offline
// resilience under many daily taps. `enteredBy` is 'employee' (kiosk, PIN-gated) or 'owner'
// (admin) — see js/paymentsMath.js's reconcileDay() for how the two sides get compared. Needs
// the `payments` table added (see supabase-setup.sql).
//
// `id` makes a retried save safe. The kiosk generates it when the payment form opens and reuses
// it if Save is tapped again after a failure. If the earlier attempt actually reached the
// server and only its response was lost (flaky Wi-Fi), the retry hits the primary key (Postgres
// error 23505) and is treated as already saved, instead of recording the same payment twice.
async function addPayment(empId, amount, occurredOn, enteredBy, id = crypto.randomUUID()){
  const row = {id, emp_id:empId, amount, occurred_on:occurredOn, entered_by:enteredBy};
  const {data, error} = await withTimeout(sb.from('payments').insert(row).select().single());
  if(error?.code === '23505') return row;
  if(error) throw error;
  return data;
}

async function listPaymentsForRange(fromDate, toDate){
  const {data, error} = await withTimeout(sb.from('payments').select('*').gte('occurred_on', fromDate).lte('occurred_on', toDate));
  if(error) throw error;
  return data;
}

// Scoped to one employee (rather than filtering listPaymentsForRange client-side) so the
// kiosk's own-payments screen never even fetches another employee's amounts.
async function listPaymentsForEmployeeRange(empId, fromDate, toDate){
  const {data, error} = await withTimeout(sb.from('payments').select('*').eq('emp_id', empId)
    .gte('occurred_on', fromDate).lte('occurred_on', toDate));
  if(error) throw error;
  return data;
}

async function updatePayment(id, amount, occurredOn){
  const {error} = await withTimeout(sb.from('payments').update({amount, occurred_on:occurredOn}).eq('id', id));
  if(error) throw error;
}

async function deletePayment(id){
  const {error} = await withTimeout(sb.from('payments').delete().eq('id', id));
  if(error) throw error;
}

async function listPaymentResolutions(fromDate, toDate){
  const {data, error} = await withTimeout(sb.from('payment_resolutions').select('*').gte('date', fromDate).lte('date', toDate));
  if(error) throw error;
  return data;
}

// Marks (or un-marks) a flagged employee+date as talked-out without necessarily editing either
// side's amount — same reversible shape as setDayOverride, upsert-by-(emp_id,date). Needs the
// `payment_resolutions` table added (see supabase-setup.sql).
async function setPaymentResolution(empId, date, resolved, note){
  const {error} = await withTimeout(sb.from('payment_resolutions')
    .upsert({emp_id:empId, date, resolved, note: note || null}, {onConflict:'emp_id,date'}));
  if(error) throw error;
}

// Manual overtime: a specific number of extra hours added to one employee's specific day, paid
// at the same hourly rate as regular hours — the owner's call, no multiplier. One row per
// (emp_id, date), upserted on add/edit. Needs the `overtime_hours` table added (see
// supabase-setup.sql).
async function listOvertimeForRange(fromDate, toDate){
  const {data, error} = await withTimeout(sb.from('overtime_hours').select('*').gte('date', fromDate).lte('date', toDate));
  if(error) throw error;
  return data;
}

async function setOvertimeHours(empId, date, hours){
  const {error} = await withTimeout(sb.from('overtime_hours')
    .upsert({emp_id:empId, date, hours}, {onConflict:'emp_id,date'}));
  if(error) throw error;
}

async function deleteOvertimeHours(empId, date){
  const {error} = await withTimeout(sb.from('overtime_hours').delete().eq('emp_id', empId).eq('date', date));
  if(error) throw error;
}

async function uploadPhoto(path, blob, {upsert = false} = {}){
  const {error} = await withTimeout(sb.storage.from('photos').upload(path, blob, {contentType:'image/jpeg', upsert}));
  if(error) throw error;
}

async function getPhotoUrl(path){
  if(!path) return null;
  // The photo may still be sitting as a local blob in the outbox (not yet uploaded) —
  // check there first so an admin viewing a very recent or still-offline punch sees the
  // photo instead of a broken signed-URL request for an object that doesn't exist yet.
  const match = (await outbox.getAllItems()).find(r => r.in_photo === path || r.out_photo === path);
  if(match){
    const blob = match.in_photo === path ? match.in_photo_blob : match.out_photo_blob;
    if(blob) return URL.createObjectURL(blob);
  }
  try{
    const {data} = await withTimeout(sb.storage.from('photos').createSignedUrl(path, 3600));
    return data ? data.signedUrl : null;
  }catch{
    return null; // offline: callers keep the initials avatar / show no photo
  }
}

// Uploads whatever photos the snapshot still holds, clearing each blob from the outbox row only
// after its own upload succeeded (and only if the row still points at that path).
async function uploadPendingPhotos(snap){
  if(snap.in_photo_blob){
    const {error} = await withTimeout(sb.storage.from('photos').upload(snap.in_photo, snap.in_photo_blob, {contentType:'image/jpeg', upsert:true}));
    if(error) throw error;
    await outbox.update(snap.clientId, cur => applyPhotoUploaded(cur, 'in', snap.in_photo), {bump:false});
  }
  if(snap.clock_out && snap.out_photo_blob){
    const {error} = await withTimeout(sb.storage.from('photos').upload(snap.out_photo, snap.out_photo_blob, {contentType:'image/jpeg', upsert:true}));
    if(error) throw error;
    await outbox.update(snap.clientId, cur => applyPhotoUploaded(cur, 'out', snap.out_photo), {bump:false});
  }
}

// A punch this tablet created: upsert-by-id is idempotent, so a retried sync after a partial
// earlier failure never errors on "already exists" or no-ops on "row doesn't exist yet".
// Only sends the snapshot; what to do with the local row afterwards is decided in syncOne, from the
// row's CURRENT state, never from this snapshot.
async function syncOwnedRow(snap){
  const fields = {
    id:snap.clientId, emp_id:snap.emp_id, date:snap.date,
    clock_in:snap.clock_in, clock_out:snap.clock_out,
    in_photo:snap.in_photo, out_photo:snap.out_photo,
    lunch_paid:snap.lunch_paid || false
  };
  // The edit marker columns are only sent for a row the owner actually edited, so ordinary punches
  // never depend on that migration having been run.
  if(snap.edited_at) Object.assign(fields, {edited_at:snap.edited_at, orig_clock_in:snap.orig_clock_in ?? null, orig_clock_out:snap.orig_clock_out ?? null});
  let {error} = await withTimeout(sb.from('records').upsert(fields));
  if(error && snap.edited_at && isMissingMarkerColumn(error)){
    ({error} = await withTimeout(sb.from('records').upsert(withoutMarker(fields))));
  }
  if(error) throw error;
}

// A clock-out queued for a session the server owns (clockOut's remote branch). A conditional
// update rather than an upsert: "set clock_out WHERE it's still null". If the session was closed,
// edited or deleted elsewhere in the meantime (another device, an admin edit), that change wins
// and this possibly stale copy can't overwrite it. It's the same idea as optimistic locking with
// a JPA @Version column, and it's atomic, unlike checking first and then writing.
async function syncRemoteClose(snap){
  const {data: updated, error} = await withTimeout(sb.from('records')
    .update({clock_out:snap.clock_out, out_photo:snap.out_photo})
    .eq('id', snap.clientId).is('clock_out', null)
    .select('id'));
  if(error) throw error;
  if(!updated?.length){
    // Nothing matched. Either an earlier attempt of this same sync already landed and only its
    // response was lost (the server then shows exactly this clock-out time), or it's a real
    // conflict, in which case the server's version stands and this queued tap is dropped.
    const {data: current, error: readError} = await withTimeout(sb.from('records').select('clock_out').eq('id', snap.clientId).maybeSingle());
    if(readError) throw readError;
    const alreadyApplied = current?.clock_out && new Date(current.clock_out).getTime() === new Date(snap.clock_out).getTime();
    if(!alreadyApplied){
      console.warn('Queued clock-out dropped: the session was closed, edited or deleted elsewhere first.', snap.clientId);
      if(snap.out_photo) sb.storage.from('photos').remove([snap.out_photo]); // its own unique path, so nothing else uses it
    }
  }
}

// The snapshot is only used to know WHAT to send and which `rev` was sent. Whatever happens to the
// outbox row afterwards is decided by outboxRules.js against the row as it is NOW, inside one
// IndexedDB transaction. Writing the snapshot back, as this used to, silently undid any tap or
// edit made while the request was in flight.
async function syncOne(clientId){
  const snap = await outbox.getItem(clientId);
  if(!snap || !needsSync(snap)) return;
  const sentRev = revOf(snap);
  try{
    await uploadPendingPhotos(snap);
    if(snap.remoteClose) await syncRemoteClose(snap);
    else await syncOwnedRow(snap);
    await outbox.update(clientId, cur => applySyncSuccess(cur, sentRev), {bump:false});
  }catch(err){
    // Refused because the sign-in is mid-renewal (js/signedOutGuard.js): not this row failing,
    // just the whole device looking offline for a minute. Counting it toward "stuck" would flash
    // a red warning at employees on a routine wake. A device that's genuinely signed out (no
    // saved session left) still counts, so the owner does hear about that.
    const renewing = isSignedOutBlock(err) && hasPersistedSession();
    await outbox.update(clientId, cur => applySyncFailure(cur, err, renewing), {bump:false});
  }
}

let syncing = false;
async function runSync(){
  // navigator.onLine is only a cheap negative short-circuit (skip a guaranteed-failing
  // attempt) — it can report true even when Supabase specifically is unreachable, so the
  // real arbiter of success is always the network call itself inside syncOne.
  if(syncing || navigator.onLine === false) return;
  syncing = true;
  try{
    // Rows already in step with the server (a clocked-in session waiting for its clock-out) are
    // skipped: re-sending them every 30s did nothing useful and widened the window for a race.
    for(const row of (await outbox.getAllItems()).filter(needsSync)) await syncOne(row.clientId);
  }finally{
    syncing = false;
  }
}

// "Pending" is exactly "the server may be behind this row" (outboxRules.js's needsSync), the same
// test the sync loop uses, so the indicator and the sync can't disagree. A clocked-in session that
// already reached the server is just local bookkeeping and is not pending.
const isRowPending = needsSync;

async function getSyncStatus(){
  const pendingRows = (await outbox.getAllItems()).filter(isRowPending);
  return {pending:pendingRows.length, stuck:pendingRows.some(r => r.attempts >= 3), signedOut:!hasPersistedSession()};
}

if(!DEMO_MODE){
  outbox.startBackgroundSync(runSync);
  // Upload anything queued during a sign-in renewal the moment it's back, not on the next 30s tick.
  onSignInRestored(outbox.kick);
}

export const supabaseStore = {
  listEmployees, addEmployee, renameEmployee, setEmployeeActive, setEmployeeAvatar,
  setEmployeePin, getEmployeePinRecord,
  listOpenSessions, clockIn, clockOut, addManualRecord,
  listRecordsForDate, listRecordsForRange, updateRecordTimes, setLunchPaid, deleteRecord,
  splitSessionForLunch,
  uploadPhoto, getPhotoUrl, getSyncStatus,
  listSalaryRates, setSalaryRate,
  listDayPayOverrides, setDayOverride,
  listOvertimeForRange, setOvertimeHours, deleteOvertimeHours,
  addPayment, listPaymentsForRange, listPaymentsForEmployeeRange, updatePayment, deletePayment,
  listPaymentResolutions, setPaymentResolution
};
