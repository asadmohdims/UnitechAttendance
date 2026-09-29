import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSize, isUsablePhoto } from './captureGuard.js';

test('captureSize scales height to the target width, keeping aspect ratio', () => {
  assert.deepEqual(captureSize(640, 480), {width: 320, height: 240});
  assert.deepEqual(captureSize(1280, 720), {width: 320, height: 180});
});

test('captureSize refuses a video with no frame yet (the 28 Sep null-photo case)', () => {
  assert.equal(captureSize(0, 0), null);
  assert.equal(captureSize(640, 0), null);
  assert.equal(captureSize(0, 480), null);
  assert.equal(captureSize(undefined, undefined), null);
  assert.equal(captureSize(NaN, NaN), null);
});

test('isUsablePhoto rejects null, undefined and empty blobs', () => {
  assert.equal(isUsablePhoto(null), false);
  assert.equal(isUsablePhoto(undefined), false);
  assert.equal(isUsablePhoto(new Blob([])), false);
});

test('isUsablePhoto accepts a non-empty blob', () => {
  assert.equal(isUsablePhoto(new Blob(['x'], {type: 'image/jpeg'})), true);
});
