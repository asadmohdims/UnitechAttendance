// Local durable queue for attendance punches waiting to sync to Supabase.
// Used only by supabaseStore.js — demoStore has no network to be offline from.
// A punch is written here first (instant, no network) and synced in the background afterward.
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

let syncFn = null;
// Fires once at startup (catches any backlog from a prior offline session), on every
// browser 'online' event, and on a flat interval — no backoff needed at this scale;
// safety comes from idempotent upserts in supabaseStore.js, not retry timing.
export function startBackgroundSync(fn, intervalMs = 30000){
  syncFn = fn;
  fn();
  window.addEventListener('online', fn);
  setInterval(fn, intervalMs);
}

// Call right after every local write so a punch syncs within moments if the network is fine.
export function kick(){ if(syncFn) syncFn(); }
