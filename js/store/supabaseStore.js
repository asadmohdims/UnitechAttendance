// Supabase-backed implementation of the store interface, used when DEMO_MODE is false.
import { sb } from '../supabaseClient.js';
import { dateStr } from '../utils.js';
import { DEMO_MODE } from '../config.js';
import * as outbox from './outbox.js';

const EMP_CACHE_KEY = 'attendance_employee_cache';

// Public record shape (no blob fields) for an outbox row that hasn't synced yet.
function toRecordShape(rec){
  return {id:rec.clientId, emp_id:rec.emp_id, date:rec.date, clock_in:rec.clock_in,
    clock_out:rec.clock_out, in_photo:rec.in_photo, out_photo:rec.out_photo,
    lunch_paid:rec.lunch_paid || false, created_at:rec.created_at};
}

async function listEmployees(){
  try{
    const {data, error} = await sb.from('employees').select('*').order('created_at');
    if(error) throw error;
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
    const {data, error} = await sb.from('records').select('*').is('clock_out', null);
    if(error) throw error;
    data.forEach(r => openSessions[r.emp_id] = r);
  }catch(err){ /* offline — fall through with whatever the outbox has */ }
  (await outbox.getAllItems()).filter(r => !r.clock_out).forEach(r => {
    openSessions[r.emp_id] = toRecordShape(r);
  });
  return openSessions;
}

async function addEmployee(name){
  const {data, error} = await sb.from('employees').insert({name}).select().single();
  if(error) throw error;
  return data;
}

async function renameEmployee(id, name){
  const {error} = await sb.from('employees').update({name}).eq('id', id);
  if(error) throw error;
}

async function setEmployeeActive(id, active){
  const {error} = await sb.from('employees').update({active}).eq('id', id);
  if(error) throw error;
}

async function setEmployeeAvatar(id, path){
  const {error} = await sb.from('employees').update({avatar:path}).eq('id', id);
  if(error) throw error;
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
    attempts:0, last_error:null, created_at:nowIso
  };
  await outbox.putItem(rec); // durable local write — this IS the "instant" part, no network involved
  outbox.kick();
  return toRecordShape(rec);
}

// `atIso` lets a caller record an exact past instant (e.g. the lunch auto-close cutoff)
// instead of "now" — defaults to now for a normal manual punch. `blob` is optional: an
// auto-close has nobody at the camera, so out_photo/out_photo_blob are only set when a real
// photo was actually captured — otherwise we'd leave a photo path pointing at nothing ever
// uploaded.
async function clockOut(recordId, blob, atIso){
  const rec = await outbox.getItem(recordId);
  if(rec){
    rec.clock_out = atIso || new Date().toISOString();
    if(blob){
      rec.out_photo = `${rec.emp_id}/${rec.clientId}-out.jpg`;
      rec.out_photo_blob = blob;
    }
    await outbox.putItem(rec);
    outbox.kick();
    return;
  }

  // Not in this browser's local outbox — the session was opened on a different device (or
  // this one's local copy was already cleared after syncing). `state.openSessions` already
  // merges in sessions like this from the server (see listOpenSessions below), so the tile
  // shown as clockable must not silently fail to actually clock out — write straight to
  // Postgres instead, same as updateRecordTimes/setLunchPaid/deleteRecord already do for the
  // same "not local" case.
  const {data: existing, error: fetchError} = await sb.from('records').select('emp_id').eq('id', recordId).maybeSingle();
  if(fetchError) throw fetchError;
  if(!existing) throw new Error('This session could not be found — it may have already been edited or deleted from the admin panel.');

  let outPhoto = null;
  if(blob){
    outPhoto = `${existing.emp_id}/${recordId}-out.jpg`;
    const {error: uploadError} = await sb.storage.from('photos').upload(outPhoto, blob, {contentType:'image/jpeg', upsert:true});
    if(uploadError) throw uploadError;
  }
  const {error} = await sb.from('records')
    .update({clock_out: atIso || new Date().toISOString(), out_photo: outPhoto})
    .eq('id', recordId);
  if(error) throw error;
}

async function listRecordsForDate(date){
  let serverRows = [];
  try{
    const {data, error} = await sb.from('records').select('*').eq('date', date).order('clock_in');
    if(error) throw error;
    serverRows = data;
  }catch(err){ /* offline — serve what's local */ }
  const merged = new Map(serverRows.map(r => [r.id, r]));
  (await outbox.getAllItems()).filter(r => r.date === date)
    .forEach(r => merged.set(r.clientId, toRecordShape(r))); // local wins — it's the only copy while unsynced
  return Array.from(merged.values()).sort((a, b) => new Date(a.clock_in) - new Date(b.clock_in));
}

async function listRecordsForRange(startDate, endDate){
  let serverRows = [];
  try{
    const {data, error} = await sb.from('records').select('*').gte('date', startDate).lte('date', endDate);
    if(error) throw error;
    serverRows = data;
  }catch(err){ /* offline — serve what's local */ }
  const merged = new Map(serverRows.map(r => [r.id, r]));
  (await outbox.getAllItems()).filter(r => r.date >= startDate && r.date <= endDate)
    .forEach(r => merged.set(r.clientId, toRecordShape(r)));
  return Array.from(merged.values());
}

async function updateRecordTimes(recordId, clockInIso, clockOutIsoOrNull){
  const rec = await outbox.getItem(recordId);
  if(rec){
    rec.clock_in = clockInIso;
    rec.clock_out = clockOutIsoOrNull;
    await outbox.putItem(rec);
    outbox.kick();
    return;
  }
  const {error} = await sb.from('records')
    .update({clock_in:clockInIso, clock_out:clockOutIsoOrNull})
    .eq('id', recordId);
  if(error) throw error;
}

// Marks (or un-marks) the lunch gap right after this session as paid work — a reversible flag,
// never a data change to the punches themselves, so toggling it off undoes it completely.
// Needs the `lunch_paid boolean default false` column added to `records` (see supabase-setup.sql).
async function setLunchPaid(recordId, paid){
  const rec = await outbox.getItem(recordId);
  if(rec){
    rec.lunch_paid = paid;
    await outbox.putItem(rec);
    outbox.kick();
    return;
  }
  const {error} = await sb.from('records').update({lunch_paid:paid}).eq('id', recordId);
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
  const rec = await outbox.getItem(recordId);
  if(rec){
    const afternoon = {
      clientId: crypto.randomUUID(), emp_id: rec.emp_id, date: rec.date,
      clock_in: lunchEndIso, clock_out: rec.clock_out,
      in_photo: null, out_photo: rec.out_photo,
      in_photo_blob: null, out_photo_blob: rec.out_photo_blob,
      attempts: 0, last_error: null, created_at: new Date().toISOString(), lunch_paid: false
    };
    rec.clock_out = lunchStartIso;
    rec.out_photo = null;
    rec.out_photo_blob = null;
    rec.lunch_paid = false;
    await outbox.putItem(rec);
    await outbox.putItem(afternoon);
    outbox.kick();
    return;
  }

  // Not in this browser's local outbox — same "write straight to Postgres" fallback
  // clockOut/updateRecordTimes/setLunchPaid/deleteRecord already use for this case.
  const {data: existing, error: fetchError} = await sb.from('records').select('*').eq('id', recordId).maybeSingle();
  if(fetchError) throw fetchError;
  if(!existing) throw new Error('This session could not be found — it may have already been edited or deleted from the admin panel.');
  const {error: insertError} = await sb.from('records').insert({
    emp_id: existing.emp_id, date: existing.date,
    clock_in: lunchEndIso, clock_out: existing.clock_out,
    in_photo: null, out_photo: existing.out_photo, lunch_paid: false
  });
  if(insertError) throw insertError;
  const {error: updateError} = await sb.from('records')
    .update({clock_out: lunchStartIso, out_photo: null, lunch_paid: false})
    .eq('id', recordId);
  if(updateError) throw updateError;
}

async function deleteRecord(record){
  const rec = await outbox.getItem(record.id);
  if(rec){
    await outbox.deleteItem(record.id);
    return;
  }
  const {error} = await sb.from('records').delete().eq('id', record.id);
  if(error) throw error;
  sb.storage.from('photos').remove([record.in_photo, record.out_photo].filter(Boolean));
}

async function listSalaryRates(empId){
  const {data, error} = await sb.from('salary_rates').select('*').eq('emp_id', empId).order('effective_from', {ascending:false});
  if(error) throw error;
  return data;
}

async function setSalaryRate(empId, {monthlySalary, effectiveFrom, note}){
  const {data, error} = await sb.from('salary_rates')
    .insert({emp_id:empId, monthly_salary:monthlySalary, effective_from:effectiveFrom, note:note || null})
    .select().single();
  if(error) throw error;
  return data;
}

async function uploadPhoto(path, blob, {upsert = false} = {}){
  const {error} = await sb.storage.from('photos').upload(path, blob, {contentType:'image/jpeg', upsert});
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
  const {data} = await sb.storage.from('photos').createSignedUrl(path, 3600);
  return data ? data.signedUrl : null;
}

async function syncOne(clientId){
  const rec = await outbox.getItem(clientId);
  if(!rec) return;
  try{
    if(rec.in_photo_blob){
      const {error} = await sb.storage.from('photos').upload(rec.in_photo, rec.in_photo_blob, {contentType:'image/jpeg', upsert:true});
      if(error) throw error;
      rec.in_photo_blob = null;
      await outbox.putItem(rec);
    }
    if(rec.clock_out && rec.out_photo_blob){
      const {error} = await sb.storage.from('photos').upload(rec.out_photo, rec.out_photo_blob, {contentType:'image/jpeg', upsert:true});
      if(error) throw error;
      rec.out_photo_blob = null;
      await outbox.putItem(rec);
    }
    // upsert-by-id is idempotent, so a retried sync after a partial earlier failure
    // never errors on "already exists" or no-ops on "row doesn't exist yet".
    const {error} = await sb.from('records').upsert({
      id:rec.clientId, emp_id:rec.emp_id, date:rec.date,
      clock_in:rec.clock_in, clock_out:rec.clock_out,
      in_photo:rec.in_photo, out_photo:rec.out_photo,
      lunch_paid:rec.lunch_paid || false
    });
    if(error) throw error;
    if(rec.clock_out){
      // Fully closed AND synced — Postgres is now the sole source of truth, drop the local copy.
      await outbox.deleteItem(rec.clientId);
    }else{
      // Still open: keep the row (clockOut/listOpenSessions still need to find it locally),
      // just clear the failure bookkeeping now that a sync attempt succeeded.
      rec.attempts = 0;
      rec.last_error = null;
      await outbox.putItem(rec);
    }
  }catch(err){
    rec.attempts = (rec.attempts || 0) + 1;
    rec.last_error = String(err.message || err);
    await outbox.putItem(rec);
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
    for(const row of await outbox.getAllItems()) await syncOne(row.clientId);
  }finally{
    syncing = false;
  }
}

// A row that's open but has already synced once (blobs cleared, no outstanding error)
// is just local bookkeeping, not something waiting on the network — only count a row as
// "pending" if it still has an unsynced photo to upload or its last sync attempt failed.
function isRowPending(r){
  return !!r.in_photo_blob || (!!r.clock_out && !!r.out_photo_blob) || r.attempts > 0;
}

async function getSyncStatus(){
  const pendingRows = (await outbox.getAllItems()).filter(isRowPending);
  return {pending:pendingRows.length, stuck:pendingRows.some(r => r.attempts >= 3)};
}

if(!DEMO_MODE) outbox.startBackgroundSync(runSync);

export const supabaseStore = {
  listEmployees, addEmployee, renameEmployee, setEmployeeActive, setEmployeeAvatar,
  listOpenSessions, clockIn, clockOut,
  listRecordsForDate, listRecordsForRange, updateRecordTimes, setLunchPaid, deleteRecord,
  splitSessionForLunch,
  uploadPhoto, getPhotoUrl, getSyncStatus,
  listSalaryRates, setSalaryRate
};
