import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFrame } from '../lib/pitch.js';

const tone = (f, sr = 48000, n = 2048) => {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / sr) + 0.1 * Math.sin((4 * Math.PI * f * i) / sr);
  return b;
};

test('pitch detector finds the fundamental without octave errors', () => {
  for (const f of [90, 110, 165, 220, 330, 420]) {
    const p = analyseFrame(tone(f), 48000).pitch;
    assert.ok(Math.abs(p - f) < 1.5, `${f} Hz read as ${p}`);
  }
});

test('silence returns no pitch', () => {
  assert.equal(analyseFrame(new Float32Array(2048), 48000).pitch, -1);
});
