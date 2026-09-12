// Zero-dependency tests using Node's built-in test runner — no npm install, no build step,
// consistent with this project's "plain JS, no bundler" constraint. Run with:
//   node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSalt, hashPin, verifyPin } from './pin.js';

describe('generateSalt', () => {
  test('produces a non-empty hex string, different on each call', () => {
    const a = generateSalt();
    const b = generateSalt();
    assert.match(a, /^[0-9a-f]+$/);
    assert.notEqual(a, b);
  });
});

describe('hashPin / verifyPin', () => {
  test('the correct PIN verifies against its own hash', async () => {
    const salt = generateSalt();
    const hash = await hashPin('4821', salt);
    assert.equal(await verifyPin('4821', salt, hash), true);
  });

  test('a wrong PIN fails verification', async () => {
    const salt = generateSalt();
    const hash = await hashPin('4821', salt);
    assert.equal(await verifyPin('0000', salt, hash), false);
  });

  test('the same PIN with a different salt produces a different hash', async () => {
    const hashA = await hashPin('4821', generateSalt());
    const hashB = await hashPin('4821', generateSalt());
    assert.notEqual(hashA, hashB);
  });
});
