// Refuses database/storage requests that aren't carrying this device's signed-in pass.
//
// Why this exists (a real production incident, 30 Sep 2026): when the tablet wakes, supabase-js
// immediately tries to renew its expired one-hour pass. If Wi-Fi is still reconnecting, that
// renewal fails, and for the next 60 seconds supabase-js doesn't give up on the request — it
// quietly sends it with only the public app key, i.e. as an anonymous visitor. Every table is
// "signed-in users only", so the database doesn't reject an anonymous read, it answers it with
// zero rows. The kiosk showed "No employees yet", saved that empty list over its offline roster,
// and every punch upload was rejected (401) until the renewal went through.
//
// Refusing those requests here, before they're sent, turns "a wrong answer" into "no answer" —
// and every screen already knows what to do with no answer: the kiosk falls back to its offline
// roster and queues punches, exactly as if Wi-Fi were down for that minute. It's one choke point
// (like a servlet filter answering 401 before the request reaches any handler), so no individual
// query can forget to check.

export const SIGNED_OUT_MESSAGE = 'Not sent — this device’s sign-in is being renewed. Try again in a minute.';

// Only data requests need a signed-in user. Sign-in/renewal calls (/auth/v1/) must go through
// with just the public key, or the device could never recover.
const GUARDED_PATHS = ['/rest/v1/', '/storage/v1/'];

// True if this request would reach the database/storage as an anonymous visitor: supabase-js
// sends either no Authorization header or the public key itself when it has no valid pass.
export function isSignedOutRequest(url, headers, {supabaseUrl, anonKey}){
  const target = new URL(url);
  if(target.origin !== new URL(supabaseUrl).origin) return false;
  if(!GUARDED_PATHS.some(path => target.pathname.startsWith(path))) return false;
  const authorization = new Headers(headers).get('Authorization');
  return !authorization || authorization === `Bearer ${anonKey}`;
}

// Wraps the fetch supabase-js is given. A refused request gets an immediate local 401 answer —
// never sent — which supabase-js hands back as an ordinary `error`, and calls onBlocked so the
// app can resync once the sign-in is renewed. A 401 rather than a thrown network error on
// purpose: supabase-js retries a GET that throws (1s + 2s + 4s), which would hold the kiosk on
// a spinner instead of failing over to its offline roster straight away. It never retries a 401.
export function refuseSignedOutRequests(baseFetch, {supabaseUrl, anonKey, onBlocked = () => {}}){
  return (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const headers = init.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined);
    if(isSignedOutRequest(url, headers, {supabaseUrl, anonKey})){
      onBlocked();
      // Shaped so both the database client (reads `message`) and storage (reads `error`/`message`)
      // surface our message.
      const body = {code: 'SIGNED_OUT', message: SIGNED_OUT_MESSAGE, error: SIGNED_OUT_MESSAGE, statusCode: '401', details: null, hint: null};
      return Promise.resolve(new Response(JSON.stringify(body), {status: 401, headers: {'content-type': 'application/json'}}));
    }
    return baseFetch(input, init);
  };
}

// supabase-js re-wraps fetch failures in its own error types (and different ones for database
// vs storage), so match on the message rather than the class.
export function isSignedOutBlock(err){
  return String(err?.message ?? err ?? '').includes(SIGNED_OUT_MESSAGE);
}

// Second safety net for the kiosk's offline roster: once a roster has been seen, an empty one
// from the server is never believed. Employees are only ever deactivated, never deleted, so a
// genuinely signed-in answer can't go from "some employees" to "none" — an empty answer after a
// real roster means something upstream went wrong (like the incident above), and wiping the one
// copy the kiosk can fall back on would turn a one-minute glitch into a dead kiosk if the
// internet then dropped too.
export function keepCachedRoster(serverRows, cachedRows){
  return Array.isArray(serverRows) && serverRows.length === 0
    && Array.isArray(cachedRows) && cachedRows.length > 0;
}
