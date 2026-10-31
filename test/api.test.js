import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../worker.js';
import { parseDeepgram } from '../api/_lib/transcribe.js';

const BASE = 'https://vl.example.workers.dev';
const APP = 'https://lsd7bkk-del.github.io';
const audio = new Uint8Array(2048).fill(1);
const req = (path, init = {}) => new Request(BASE + path, init);
const post = (headers = {}, body = audio) =>
  req('/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/webm', ...headers }, body });

test('status in mock mode reports no secrets', async () => {
  const res = await route(req('/api/status'), { PROVIDER_MODE: 'mock' });
  const body = await res.json();
  assert.equal(body.mode, 'mock');
  assert.equal(body.transcription.provider, 'mock');
});

test('status never leaks key values or the access code (AT-14)', async () => {
  const env = { DEEPGRAM_API_KEY: 'dg-SECRET-123', ANTHROPIC_API_KEY: 'sk-ant-SECRET-456', APP_ACCESS_CODE: 'open-sesame-789' };
  const text = await (await route(req('/api/status'), env)).text();
  for (const secret of Object.values(env)) assert.ok(!text.includes(secret), `leaked ${secret}`);
  const body = JSON.parse(text);
  assert.equal(body.mode, 'live');
  assert.equal(body.transcription.configured, true);
  assert.equal(body.accessCodeSet, true);
});

test('mock transcription works with no credentials (AT-13)', async () => {
  const res = await route(post({ 'x-duration-seconds': '20' }), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.simulated, true);
  assert.ok(body.words.length > 10);
});

test('live mode fails closed without an access code set', async () => {
  const res = await route(post(), { DEEPGRAM_API_KEY: 'x' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'access_code_not_set');
});

test('wrong access code is rejected; right one passes the gate', async () => {
  const env = { PROVIDER_MODE: 'mock', APP_ACCESS_CODE: 'right' };
  assert.equal((await route(post({ 'x-access-code': 'wrong' }), env)).status, 401);
  assert.equal((await route(post({ 'x-access-code': 'right' }), env)).status, 200);
});

test('unsupported and empty audio are rejected', async () => {
  assert.equal((await route(post({ 'content-type': 'text/plain' }), {})).status, 415);
  assert.equal((await route(post({}, new Uint8Array(0)), {})).status, 400);
});

test('provider failure returns a retryable error so the app keeps the attempt (AT-13)', async () => {
  const env = {
    APP_ACCESS_CODE: 'c',
    AI: { run: async () => { throw new Error('upstream timeout'); } },
  };
  const res = await route(post({ 'x-access-code': 'c' }), env);
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error.retryable, true);
});

test('Workers AI route sends filler_words and parses timed words', async () => {
  let seen = null;
  const env = {
    APP_ACCESS_CODE: 'c',
    AI: {
      run: async (model, input) => {
        seen = { model, input };
        return { results: { channels: [{ alternatives: [{ transcript: 'um hello there', words: [
          { word: 'um', start: 0.2, end: 0.4, confidence: 0.9 },
          { word: 'hello', start: 0.5, end: 0.9, confidence: 0.99 },
          { word: 'there', start: 1.0, end: 1.3, confidence: 0.99 },
        ] }] }] }, metadata: { duration: 2.1 } };
      },
    },
  };
  const res = await route(post({ 'x-access-code': 'c', 'content-type': 'audio/mp4' }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(seen.model, '@cf/deepgram/nova-3');
  assert.equal(seen.input.filler_words, true);
  assert.equal(seen.input.audio.contentType, 'audio/mp4');
  assert.equal(body.provider, 'workers-ai');
  assert.equal(body.words.length, 3);
  assert.equal(body.capabilities.word_timestamps, true);
  assert.equal(body.duration, 2.1);
});

test('Deepgram parser keeps punctuated display words and rejects empty responses', () => {
  const out = parseDeepgram({ results: { channels: [{ alternatives: [{ transcript: 'Hi.', words: [{ word: 'hi', punctuated_word: 'Hi.', start: 0, end: 0.3 }] }] }] } });
  assert.equal(out.words[0].display, 'Hi.');
  assert.throws(() => parseDeepgram({}), /no transcript/);
});

test('CORS: allowed origin gets headers; others are refused', async () => {
  const env = { PROVIDER_MODE: 'mock', ALLOWED_ORIGINS: APP };
  const ok = await route(req('/api/status', { headers: { origin: APP } }), env);
  assert.equal(ok.headers.get('access-control-allow-origin'), APP);
  const pre = await route(req('/api/transcribe', { method: 'OPTIONS', headers: { origin: APP } }), env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-access-code/);
  const bad = await route(req('/api/status', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(bad.status, 403);
});

test('unknown routes 404', async () => {
  assert.equal((await route(req('/api/nope'), {})).status, 404);
});
