import { json, providerMode, transcriptionProvider } from './_lib/http.js';

// Reports configuration STATUS only. Never returns key values or the access code.
export function GET() { return handleStatus(process.env); }

export function handleStatus(env = {}) {
  const mode = providerMode(env);
  // In mock mode the canned test provider stands in for everything.
  const stt = transcriptionProvider(env) || (mode === 'mock' ? 'mock' : null);
  return json({
    mode,
    transcription: { provider: stt || 'none', configured: Boolean(stt) },
    coach: mode === 'mock'
      ? { provider: 'mock', configured: true }
      : { provider: 'anthropic', configured: Boolean(env.ANTHROPIC_API_KEY) },
    accessCodeSet: Boolean(env.APP_ACCESS_CODE),
    accessRequired: Boolean(env.APP_ACCESS_CODE) || mode === 'live',
  });
}
