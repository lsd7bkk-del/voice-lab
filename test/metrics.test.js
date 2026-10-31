import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, speechSegments, countCandidates, median } from '../lib/metrics.js';
import { mockTranscription } from '../lib/mock.js';

const byId = (r, id) => r.metrics.find((m) => m.id === id);
const w = (word, start, end) => ({ word, start, end });

test('typed sessions get no vocal metrics — every delivery metric is null with a reason (AT-7)', () => {
  const r = computeMetrics({ modality: 'typed' });
  for (const m of r.metrics) {
    assert.equal(m.value, null, m.id);
    assert.equal(m.availability, 'unavailable');
    assert.match(m.reason, /Typed answer/);
  }
});

test('missing word timings → timing metrics null with reason, never zero (AT-8)', () => {
  const r = computeMetrics({
    modality: 'voice',
    transcription: { words: [{ word: 'hello' }, { word: 'there' }], duration: 10, capabilities: { word_timestamps: false, disfluencies: true } },
  });
  for (const id of ['speaking_rate', 'pause_count', 'pause_median', 'longest_run', 'response_latency']) {
    const m = byId(r, id);
    assert.equal(m.value, null, id);
    assert.match(m.reason, /did not return word timings/);
  }
});

test('talk-time share is null when no counterparty speech is measured (AT-8)', () => {
  const r = computeMetrics({ modality: 'voice', transcription: mockTranscription(24) });
  const m = byId(r, 'talk_time_share');
  assert.equal(m.value, null);
  assert.match(m.reason, /counterparty/);
});

test('fillers are null with a reason when the provider strips disfluencies', () => {
  const r = computeMetrics({
    modality: 'voice',
    transcription: { words: [w('ok', 0, 0.3)], duration: 10, capabilities: { word_timestamps: true, disfluencies: false } },
  });
  assert.equal(byId(r, 'filler_count').value, null);
  assert.match(byId(r, 'filler_count').reason, /removes fillers/);
});

test('pace, fillers, pauses computed from timed words', () => {
  const words = [
    w('so', 0.5, 0.7), w('um', 0.8, 1.0), w('we', 1.1, 1.3), w('should', 1.4, 1.7), w('ship', 1.8, 2.1),
    // 1.9 s gap → one pause
    w('in', 4.0, 4.2), w('april', 4.3, 4.8), w('uh', 4.9, 5.1), w('basically', 5.2, 5.8), w('now', 5.9, 6.2),
  ];
  const r = computeMetrics({
    modality: 'voice',
    transcription: { words, duration: 10, capabilities: { word_timestamps: true, disfluencies: true } },
    client: { promptShownAt: 1000, recordStartedAt: 3000 },
  });
  assert.equal(byId(r, 'filler_count').value, 2);
  assert.equal(byId(r, 'overall_wpm').value, 48); // 8 content words over 10 s
  assert.equal(byId(r, 'pause_count').value, 1);
  assert.equal(byId(r, 'pause_median').value, 1.9);
  assert.equal(byId(r, 'response_latency').value, 2.5); // 2 s before recording + 0.5 s to first word
  assert.deepEqual(r.candidates, { basically: 1 });
});

test('very short recordings suppress rates instead of reporting noise', () => {
  const r = computeMetrics({
    modality: 'voice',
    transcription: { words: [w('hi', 0.2, 0.5)], duration: 2, capabilities: { word_timestamps: true, disfluencies: true } },
  });
  assert.equal(byId(r, 'overall_wpm').value, null);
  assert.match(byId(r, 'overall_wpm').reason, /too short/);
});

test('pitch metrics need enough voiced frames; computed when present', () => {
  const none = computeMetrics({ modality: 'voice', transcription: mockTranscription(24), signal: { pitchHz: [120, 125], rms: [] } });
  assert.equal(byId(none, 'pitch_median').value, null);
  const pitchHz = Array.from({ length: 60 }, (_, i) => 110 + (i % 10) * 4);
  const rms = Array.from({ length: 60 }, (_, i) => 0.05 + (i % 5) * 0.01);
  const ok = computeMetrics({ modality: 'voice', transcription: mockTranscription(24), signal: { pitchHz, rms } });
  assert.ok(byId(ok, 'pitch_median').value > 100);
  assert.ok(byId(ok, 'pitch_variation').value > 0);
  assert.ok(byId(ok, 'level_steadiness').value > 0);
});

test('helpers: segments, candidate phrases, median', () => {
  assert.equal(speechSegments([w('a', 0, 0.2), w('b', 0.5, 0.7), w('c', 2, 2.2)]).length, 2);
  assert.deepEqual(countCandidates(['you', 'know', 'it', 'is', 'kind', 'of', 'like', 'this']), { like: 1, 'you know': 1, 'kind of': 1 });
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('mock transcription is marked simulated and fits inside the recording', () => {
  const t = mockTranscription(30);
  assert.equal(t.simulated, true);
  assert.ok(t.words.at(-1).end <= t.duration);
});
