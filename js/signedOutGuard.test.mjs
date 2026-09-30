import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  isSignedOutRequest, refuseSignedOutRequests, isSignedOutBlock, keepCachedRoster, SIGNED_OUT_MESSAGE
} from './signedOutGuard.js';

const supabaseUrl = 'https://proj.supabase.co';
const anonKey = 'sb_publishable_test';
const opts = {supabaseUrl, anonKey};

describe('isSignedOutRequest', () => {
  test('a data request carrying only the public key is signed out', () => {
    assert.equal(isSignedOutRequest(`${supabaseUrl}/rest/v1/employees`, {Authorization: `Bearer ${anonKey}`}, opts), true);
  });
  test('a data request with no Authorization header at all is signed out', () => {
    assert.equal(isSignedOutRequest(`${supabaseUrl}/rest/v1/records`, {}, opts), true);
  });
  test('photo storage is guarded the same way', () => {
    assert.equal(isSignedOutRequest(`${supabaseUrl}/storage/v1/object/photos/a.jpg`, {Authorization: `Bearer ${anonKey}`}, opts), true);
  });
  test('a data request carrying a user pass goes through', () => {
    assert.equal(isSignedOutRequest(`${supabaseUrl}/rest/v1/employees`, new Headers({Authorization: 'Bearer user.jwt.token'}), opts), false);
  });
  test('sign-in and renewal calls are never blocked, or the device could never recover', () => {
    assert.equal(isSignedOutRequest(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {Authorization: `Bearer ${anonKey}`}, opts), false);
  });
  test('requests to other hosts are left alone', () => {
    assert.equal(isSignedOutRequest('https://example.com/rest/v1/x', {}, opts), false);
  });
});

describe('refuseSignedOutRequests', () => {
  test('refuses a signed-out request without calling the network, and reports it', async () => {
    let networkCalls = 0, blocked = 0;
    const guarded = refuseSignedOutRequests(async () => { networkCalls++; return new Response('[]'); }, {...opts, onBlocked: () => blocked++});
    const res = await guarded(`${supabaseUrl}/rest/v1/employees`, {headers: {Authorization: `Bearer ${anonKey}`}});
    assert.equal(res.status, 401); // a 401, not a thrown error: supabase-js retries throws, never 401s
    assert.ok(isSignedOutBlock(await res.json()));
    assert.equal(networkCalls, 0);
    assert.equal(blocked, 1);
  });
  test('passes a signed-in request straight through', async () => {
    let networkCalls = 0;
    const guarded = refuseSignedOutRequests(async () => { networkCalls++; return new Response('[]'); }, opts);
    await guarded(`${supabaseUrl}/rest/v1/employees`, {headers: {Authorization: 'Bearer user.jwt.token'}});
    assert.equal(networkCalls, 1);
  });
});

describe('keepCachedRoster', () => {
  const roster = [{id: 'e1', name: 'A'}];
  test('an empty server roster never replaces a real saved one', () => {
    assert.equal(keepCachedRoster([], roster), true);
  });
  test('a first-ever empty roster (fresh setup, nothing saved) is believed', () => {
    assert.equal(keepCachedRoster([], null), false);
    assert.equal(keepCachedRoster([], []), false);
  });
  test('a non-empty server roster always wins', () => {
    assert.equal(keepCachedRoster([{id: 'e2'}], roster), false);
  });
});

// ---------------------------------------------------------------------------------------------
// Replay of the 30 Sep 2026 production incident, against the exact supabase-js file the app
// ships (vendor/), not a mock of it. The tablet wakes with an expired pass, the renewal fails
// because Wi-Fi is still reconnecting, then Wi-Fi comes back within the library's 60s retry
// cooldown and the kiosk loads its roster.
// ---------------------------------------------------------------------------------------------

vm.runInThisContext(readFileSync(new URL('../vendor/supabase-js-2.117.0.js', import.meta.url), 'utf8'));
const { createClient } = globalThis.supabase;

// A tablet with a saved sign-in whose one-hour pass has expired, a switchable "Wi-Fi", and a fake
// Supabase that answers an anonymous roster read the way row-level security really does: 200 [].
// The clock is moved forward on each failed attempt so the library's ~30s of renewal retries
// finish in milliseconds; it runs the same code path either way.
function wakeTablet({guard}){
  const realNow = Date.now;
  let skewMs = 0;
  Date.now = () => realNow() + skewMs;
  const nowSec = () => Math.floor(Date.now() / 1000);

  const saved = new Map([['sb-proj-auth-token', JSON.stringify({
    access_token: 'old.user.pass', refresh_token: 'r1', token_type: 'bearer', expires_in: 3600,
    expires_at: nowSec() - 600, user: {id: 'u1'}
  })]]);
  const storage = {getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k)};

  const tablet = {wifi: false, sent: [], events: [], saved, advance: ms => { skewMs += ms; }, restoreClock: () => { Date.now = realNow; }};
  const network = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if(!tablet.wifi){ skewMs += 10000; throw new TypeError('Failed to fetch'); }
    tablet.sent.push({path: url.pathname, auth: new Headers(init.headers).get('Authorization')});
    const json = body => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
    if(url.pathname === '/auth/v1/token'){
      return json({access_token: 'new.user.pass', refresh_token: 'r2', token_type: 'bearer', expires_in: 3600, expires_at: nowSec() + 3600, user: {id: 'u1'}});
    }
    const signedIn = new Headers(init.headers).get('Authorization') === 'Bearer new.user.pass';
    return json(signedIn ? [{id: 'e1', name: 'Real employee'}] : []);
  };
  const fetch = guard ? refuseSignedOutRequests(network, opts) : network;
  tablet.sb = createClient(supabaseUrl, anonKey, {global: {fetch}, auth: {storage, autoRefreshToken: false}});
  tablet.sb.auth.onAuthStateChange(event => tablet.events.push(event));
  return tablet;
}

describe('incident replay (real vendored supabase-js)', () => {
  test('WITHOUT the guard: the roster read goes out anonymously and comes back empty with no error — the bug', async () => {
    const tablet = wakeTablet({guard: false});
    try{
      await tablet.sb.auth.getSession(); // woke up: renewal fails, Wi-Fi not back yet
      assert.equal(tablet.saved.has('sb-proj-auth-token'), true, 'the session stays saved, which is what fooled the old check');
      tablet.wifi = true;               // Wi-Fi back a few seconds later
      const {data, error} = await tablet.sb.from('employees').select('*');
      assert.equal(error, null);
      assert.deepEqual(data, []);       // "No employees yet"
      assert.equal(tablet.sent.at(-1).auth, `Bearer ${anonKey}`);
    }finally{ tablet.restoreClock(); }
  });

  test('WITH the guard: the same read is refused before it is sent, so the kiosk falls back to its offline roster', async () => {
    const tablet = wakeTablet({guard: true});
    try{
      await tablet.sb.auth.getSession();
      tablet.wifi = true;
      const {data, error} = await tablet.sb.from('employees').select('*');
      assert.equal(data, null);
      assert.ok(isSignedOutBlock(error), `expected a signed-out refusal, got: ${error?.message}`);
      assert.equal(tablet.sent.filter(r => r.path.startsWith('/rest/')).length, 0, 'nothing anonymous reached the database');
    }finally{ tablet.restoreClock(); }
  });

  test('WITH the guard: a queued photo upload is refused the same recognisable way (not counted as a failed sync)', async () => {
    const tablet = wakeTablet({guard: true});
    try{
      await tablet.sb.auth.getSession();
      tablet.wifi = true;
      const {error} = await tablet.sb.storage.from('photos').upload('e1/in.jpg', new Blob(['x']));
      assert.ok(isSignedOutBlock(error), `expected a signed-out refusal, got: ${error?.message}`);
      assert.equal(tablet.sent.filter(r => r.path.startsWith('/storage/')).length, 0);
    }finally{ tablet.restoreClock(); }
  });

  test('WITH the guard: once the cooldown passes, the pass renews, the app is told, and real data flows', async () => {
    const tablet = wakeTablet({guard: true});
    try{
      await tablet.sb.auth.getSession();
      tablet.wifi = true;
      await tablet.sb.from('employees').select('*'); // refused, as above
      tablet.advance(61000);                          // the library's 60s renewal cooldown ends
      const {data, error} = await tablet.sb.from('employees').select('*');
      assert.equal(error, null);
      assert.deepEqual(data, [{id: 'e1', name: 'Real employee'}]);
      assert.equal(tablet.sent.at(-1).auth, 'Bearer new.user.pass');
      assert.ok(tablet.events.includes('TOKEN_REFRESHED'), 'the event the app listens for to resync and upload queued punches');
    }finally{ tablet.restoreClock(); }
  });
});

test('the refusal message is the one isSignedOutBlock recognises', () => {
  assert.equal(isSignedOutBlock(new Error(SIGNED_OUT_MESSAGE)), true);
  assert.equal(isSignedOutBlock(new Error('Failed to fetch')), false);
});
