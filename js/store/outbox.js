// Local durable queue for attendance punches waiting to sync to Supabase.
// Used only by supabaseStore.js — demoStore has no network to be offline from.
// A punch is written here first (instant, no network) and synced in the background afterward.
import { DELETE, revOf } from './outboxRules.js';

const DB_NAME = 'unitech_attendance_outbox';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME, {keyPath:'clientId'}); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = fn(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export function putItem(item){ return withStore('readwrite', s => s.put(item)); }
export function getItem(clientId){ return withStore('readonly', s => s.get(clientId)); }
export function deleteItem(clientId){ return withStore('readwrite', s => s.delete(clientId)); }
export function getAllItems(){ return withStore('readonly', s => s.getAll()); }

// Atomic read-modify-write of one row. The get, `fn` and the put/delete all happen inside ONE
// readwrite transaction, and IndexedDB runs readwrite transactions on a store one at a time, so no
// other writer can slip in between (the same guarantee as SELECT ... FOR UPDATE). The old pattern —
// getItem, change it, putItem later in separate transactions — let a sync that had read a row
// minutes earlier write its stale copy over a clock-out tapped in the meantime.
//
// `fn(row)` must be synchronous (a transaction closes once control returns to the event loop with
// nothing pending) and returns the new row, `undefined` to leave the row alone, or DELETE. If it
// throws, the transaction is aborted and the error is passed on, so nothing is half-written.
// `rev` — the optimistic-lock counter (see outboxRules.js) — goes up on every real content change;
// pass {bump:false} for bookkeeping that is not one (clearing an uploaded photo, retry counters).
// Resolves {status:'missing'|'unchanged'|'updated'|'deleted', row}.
export function update(clientId, fn, {bump = true} = {}){
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let result = {status:'missing', row:null};
    const req = store.get(clientId);
    req.onsuccess = () => {
      const cur = req.result;
      if(!cur) return;
      let next;
      try{ next = fn(cur); }
      catch(err){ reject(err); tx.abort(); return; }
      if(next === undefined){ result = {status:'unchanged', row:cur}; return; }
      if(next === DELETE){ store.delete(clientId); result = {status:'deleted', row:null}; return; }
      const stored = bump ? {...next, rev: revOf(cur) + 1} : next;
      store.put(stored);
      result = {status:'updated', row:stored};
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Outbox transaction aborted'));
  }));
}

let syncFn = null;
// Fires once at startup (catches any backlog from a prior offline session), on every
// browser 'online' event, and on a flat interval — no backoff needed at this scale;
// safety comes from idempotent upserts in supabaseStore.js, not retry timing.
export function startBackgroundSync(fn, intervalMs = 30000){
  // This queue can hold the only copy of a punch. By default browsers treat site storage as
  // "best effort" and may clear it under storage pressure; persistent storage opts out of that.
  // Chrome decides silently (typically granted for an installed app), so the kiosk never sees a prompt.
  navigator.storage?.persist?.().catch(() => {});
  syncFn = fn;
  fn();
  window.addEventListener('online', fn);
  setInterval(fn, intervalMs);
}

// Call right after every local write so a punch syncs within moments if the network is fine.
export function kick(){ if(syncFn) syncFn(); }
