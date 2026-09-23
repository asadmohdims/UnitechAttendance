// Guards sw.js's APP_SHELL list against drift. A module or asset missing from it still works
// while online, so nothing looks wrong until the kiosk has to boot with no Wi-Fi right after a
// deploy. This test catches that at `node --test` time instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

function appShell(){
  const block = read('sw.js').match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'APP_SHELL array not found in sw.js');
  return [...block[1].matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
}

function jsModules(dir = 'js'){
  return readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if(entry.isDirectory()) return jsModules(path);
    return entry.name.endsWith('.js') ? [path] : []; // tests are .mjs, so they're excluded
  });
}

const isLocal = ref => ref && !/^(https?:|data:|#|mailto:)/.test(ref);

test('every APP_SHELL entry exists on disk (addAll() fails the whole install on one 404)', () => {
  const missing = appShell().filter(path => !existsSync(join(root, path)));
  assert.deepEqual(missing, []);
});

test('every JS module under js/ is pre-cached', () => {
  const shell = new Set(appShell());
  assert.deepEqual(jsModules().filter(path => !shell.has(path)), []);
});

test('every same-origin file index.html references is pre-cached', () => {
  const shell = new Set(appShell());
  const refs = [...read('index.html').matchAll(/(?:src|href)="([^"]*)"/g)].map(m => m[1]).filter(isLocal);
  assert.deepEqual(refs.map(ref => normalize(ref)).filter(path => !shell.has(path)), []);
});

test('every url() in css/styles.css is pre-cached', () => {
  const shell = new Set(appShell());
  const refs = [...read('css/styles.css').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]).filter(isLocal);
  assert.deepEqual(refs.map(ref => normalize(join('css', ref))).filter(path => !shell.has(path)), []);
});

// The root cause of "the kiosk waits for Wi-Fi to show the page": a CDN <script> or stylesheet
// in <head> holds up the whole page until it loads, and the service worker can't cache it.
test('index.html loads no cross-origin scripts or stylesheets', () => {
  const html = read('index.html');
  const external = [
    ...html.matchAll(/<script[^>]+src="(https?:[^"]+)"/g),
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(https?:[^"]+)"/g),
  ].map(m => m[1]);
  assert.deepEqual(external, []);
});
