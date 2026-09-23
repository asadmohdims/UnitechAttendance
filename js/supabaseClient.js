import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE } from './config.js';

if(!DEMO_MODE && SUPABASE_URL.startsWith('PASTE')){
  document.body.innerHTML = '<div style="padding:40px; font-family:sans-serif"><h2>Not configured</h2><p>Supabase URL and anon key have not been set in js/config.js yet.</p></div>';
  throw new Error('Supabase not configured');
}

/* ---------- time limits on every network call ----------
   The shop's Wi-Fi is often "connected but barely working", and a request on a connection like
   that can sit for minutes before the browser gives up. Nothing in this app may wait on it that
   long, so there are three limits:
   - HTTP_TIMEOUT_MS caps each individual HTTP request (data, photos, sign-in, token refresh)
     via the fetch supabase-js is given below. It's the backstop for anything not wrapped in
     withTimeout().
   - REQUEST_TIMEOUT_MS is the default for withTimeout(): how long any one store call may keep
     the UI waiting before it reports "no response". It's measured from the call, not the
     request, so it also covers time spent queued behind a slow token refresh. supabase-js
     retries a failed refresh for up to ~30s, and every other call waits behind it.
   - FAST_READ_TIMEOUT_MS is for kiosk reads that have a local fallback (roster, open sessions,
     today's punches), where failing over quickly IS the point. */
export const HTTP_TIMEOUT_MS = 15000;
export const REQUEST_TIMEOUT_MS = 8000;
export const FAST_READ_TIMEOUT_MS = 3000;
export const TIMEOUT_MESSAGE = 'No response from the server — check the Wi-Fi connection.';

function fetchWithTimeout(input, init = {}){
  if(!AbortSignal.timeout) return fetch(input, init); // pre-2022 browser: no backstop, still works
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  const signal = init.signal && AbortSignal.any ? AbortSignal.any([init.signal, timeout]) : (init.signal || timeout);
  return fetch(input, {...init, signal});
}

export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {fetch: fetchWithTimeout}
});

// Rejects with TIMEOUT_MESSAGE if `request` (a supabase-js query builder, or any promise) hasn't
// settled within `ms`. For database queries it also cancels the request. That matters for
// writes: a write still queued behind a slow token refresh must never go out *after* the UI has
// already said it failed. (Photo uploads can't be cancelled this way; HTTP_TIMEOUT_MS bounds them.)
export function withTimeout(request, ms = REQUEST_TIMEOUT_MS){
  const controller = new AbortController();
  if(typeof request.abortSignal === 'function') request.abortSignal(controller.signal);
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(TIMEOUT_MESSAGE)); }, ms);
  });
  return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
}

/* ---------- this device's saved sign-in, read locally ----------
   Same key format supabase-js itself uses for persisted sessions (sb-<project-ref>-auth-token),
   read directly rather than through sb.auth.getSession(), which waits on any in-progress token
   refresh — i.e. on the network, exactly when these checks need to not depend on it. */
function authStorageKey(){
  return `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
}

export function persistedSession(){
  try{
    return JSON.parse(localStorage.getItem(authStorageKey()) || 'null');
  }catch{
    return null;
  }
}

// True if this device is signed in, even if the access token has since expired by the clock.
// supabase-js only deletes this entry on a real sign-out or a refresh the server definitively
// rejected, never because the network was down.
export function hasPersistedSession(){
  const session = persistedSession();
  return !!(session && session.access_token && session.refresh_token);
}
