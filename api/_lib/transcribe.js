// Transcription provider adapter.
// Each provider returns the same shape and DECLARES its timing capabilities:
//   { provider, text, words:[{word,display,start,end,confidence}], duration,
//     capabilities: { word_timestamps:boolean, disfluencies:boolean }, simulated?:boolean }
//
// Providers:
//   deepgram    Deepgram's own API (needs DEEPGRAM_API_KEY)
//   workers-ai  Deepgram Nova-3 hosted by Cloudflare Workers AI (needs the AI binding, no Deepgram account)
//   mock        Canned transcript, no keys

import { providerMode, transcriptionProvider } from './http.js';
import { mockTranscription } from '../../lib/mock.js';

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const WORKERS_AI_MODEL = '@cf/deepgram/nova-3';

/** Parses a Deepgram-format response (direct API or Workers AI) into the adapter shape. Exported for tests. */
export function parseDeepgram(body, provider = 'deepgram') {
  const root = body?.result ?? body; // some Workers AI clients wrap output in { result }
  const alt = root?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) throw Object.assign(new Error('The transcription service returned no transcript.'), { code: 'bad_provider_response' });
  const words = (alt.words || []).map((w) => ({
    word: w.word,
    display: w.punctuated_word || w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));
  const lastEnd = words.length ? words[words.length - 1].end : null;
  return {
    provider,
    text: alt.transcript || '',
    words,
    duration: root?.metadata?.duration ?? null,
    lastWordEnd: lastEnd,
    capabilities: {
      word_timestamps: words.length > 0 && words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end)),
      // We request filler_words=true from both routes, so "um"/"uh" are kept.
      disfluencies: true,
    },
  };
}

async function deepgram(audio, contentType, env) {
  const params = new URLSearchParams({
    model: env.DEEPGRAM_MODEL || 'nova-3',
    language: 'en',
    filler_words: 'true', // keep "um"/"uh" so fillers can be counted (spec §5)
    punctuate: 'true',
  });
  const res = await fetch(`${DEEPGRAM_URL}?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': contentType || 'application/octet-stream' },
    body: audio,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw Object.assign(new Error(`The transcription service returned ${res.status}.`), { code: 'provider_error', status: res.status, detail });
  }
  return parseDeepgram(await res.json(), 'deepgram');
}

async function workersAi(audio, contentType, env) {
  // Input shape per the model's published schema: audio: { body, contentType }.
  // Verify against a real call on first deploy (see README → "First live test").
  const out = await env.AI.run(env.WORKERS_AI_STT_MODEL || WORKERS_AI_MODEL, {
    audio: { body: new Response(audio).body, contentType: contentType || 'application/octet-stream' },
    language: 'en',
    filler_words: true,
    punctuate: true,
  });
  return parseDeepgram(out, 'workers-ai');
}

export async function transcribe(audio, contentType, { env = {}, durationHint } = {}) {
  const provider = transcriptionProvider(env);
  // No keys at all = mock mode (spec: everything runs without credentials).
  if (provider === 'mock' || (!provider && providerMode(env) === 'mock')) return mockTranscription(durationHint);
  if (provider === 'deepgram') return deepgram(audio, contentType, env);
  if (provider === 'workers-ai') {
    try { return await workersAi(audio, contentType, env); }
    catch (err) {
      if (err.code) throw err;
      throw Object.assign(new Error('Cloudflare transcription failed.'), { code: 'provider_error', detail: String(err.message || err).slice(0, 300) });
    }
  }
  throw Object.assign(new Error('Transcription is not configured on the server.'), { code: 'provider_missing' });
}
