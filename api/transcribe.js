import { checkAccess, errorJson, json } from './_lib/http.js';
import { transcribe } from './_lib/transcribe.js';

// Vercel entry (also reused by the Cloudflare worker and tests via handleTranscribe).
export const config = { maxDuration: 60 };
export function POST(request) { return handleTranscribe(request, process.env); }

const MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request limit (~5+ min of compressed speech)
const ALLOWED = /^audio\/(webm|mp4|mpeg|ogg|wav|x-wav|aac|x-m4a|m4a)/;

export async function handleTranscribe(request, env) {
  const denied = await checkAccess(request, env);
  if (denied) return denied;

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!ALLOWED.test(contentType)) return errorJson(415, 'unsupported_audio', `Unsupported audio type: ${contentType || 'none'}.`);

  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0) return errorJson(400, 'empty_audio', 'The recording was empty.');
  if (audio.byteLength > MAX_BYTES) return errorJson(413, 'audio_too_large', 'Recording is too long. Keep answers under about 5 minutes.');

  const durationHint = Number(request.headers.get('x-duration-seconds'));
  try {
    return json(await transcribe(audio, contentType, { env, durationHint }));
  } catch (err) {
    const status = err.code === 'provider_missing' ? 503 : 502;
    return errorJson(status, err.code || 'transcription_failed', err.message, { retryable: status === 502 });
  }
}
