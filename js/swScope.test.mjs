import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Runs the real sw.js in a sandbox that stands in for a service worker, and asks it who answers which
// request. The worker's scope covers the whole site, including the 2.0 rebuild's folder (.../v2/), and it
// answers every navigation with v1's index.html: a device with v1 installed must not get v1 when it asks for v2.
function loadWorker(scope) {
  const handlers = {};
  const self = {
    location: new URL(scope),
    registration: { scope },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const cache = { match: async () => undefined, put: async () => {}, addAll: async () => {} };
  const context = vm.createContext({
    self, URL, Request, Response, console,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async () => ({ ok: false, clone() { return this; } }),
  });
  vm.runInContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  return (path, mode = 'navigate') => {
    let answered = false;
    handlers.fetch({
      request: { method: 'GET', url: new URL(path, scope).href, mode },
      respondWith: () => { answered = true; },
    });
    return answered;
  };
}

test('v1 still answers its own pages and files', () => {
  const answers = loadWorker('https://asadmohdims.github.io/UnitechAttendance/');
  assert.equal(answers('/UnitechAttendance/'), true);
  assert.equal(answers('/UnitechAttendance/index.html'), true);
  assert.equal(answers('/UnitechAttendance/css/styles.css', 'no-cors'), true);
});

test('v1 leaves the whole v2 folder alone: its pages and its files', () => {
  const answers = loadWorker('https://asadmohdims.github.io/UnitechAttendance/');
  assert.equal(answers('/UnitechAttendance/v2/'), false);
  assert.equal(answers('/UnitechAttendance/v2/index.html'), false);
  assert.equal(answers('/UnitechAttendance/v2/assets/index-abc.js', 'no-cors'), false);
  assert.equal(answers('/UnitechAttendance/v2/sw.js', 'no-cors'), false);
});

test('a folder that only starts with the same letters is still v1', () => {
  const answers = loadWorker('https://asadmohdims.github.io/UnitechAttendance/');
  assert.equal(answers('/UnitechAttendance/v2-notes.html'), true);
});

test('the same holds when served from the root, as the local dev server does', () => {
  const answers = loadWorker('http://localhost:8743/');
  assert.equal(answers('/'), true);
  assert.equal(answers('/v2/'), false);
});
