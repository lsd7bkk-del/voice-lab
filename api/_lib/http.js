// Shared HTTP helpers. Web-standard only (Request/Response/crypto.subtle),
// so the same handlers run on Cloudflare Workers, Vercel and Node 18+.

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function errorJson(status, code, message, extra = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

/** Which transcription backend is configured, if any. */
export function transcriptionProvider(env = {}) {
  if (env.PROVIDER_MODE === 'mock') return 'mock';
  if (env.DEEPGRAM_API_KEY) return 'deepgram';
  if (env.AI && typeof env.AI.run === 'function') return 'workers-ai';
  return null;
}

/** Live mode = at least one real provider is configured. Mock mode needs no keys. */
export function providerMode(env = {}) {
  if (env.PROVIDER_MODE === 'mock') return 'mock';
  return transcriptionProvider(env) || env.ANTHROPIC_API_KEY ? 'live' : 'mock';
}

async function digest(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return new Uint8Array(buf);
}

/** Constant-time comparison of two strings via their SHA-256 digests. */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Access code check. Fails closed in live mode: with providers configured but no
 * APP_ACCESS_CODE set, nothing that spends credit is allowed.
 * Returns null when access is granted, or an error Response.
 */
export async function checkAccess(request, env = {}) {
  const expected = env.APP_ACCESS_CODE;
  if (!expected) {
    return providerMode(env) === 'mock'
      ? null
      : errorJson(503, 'access_code_not_set', 'Set APP_ACCESS_CODE in the server settings before using live providers.');
  }
  const given = request.headers.get('x-access-code') || '';
  if (!(await safeEqual(given, expected))) {
    return errorJson(401, 'bad_access_code', 'Access code is missing or wrong. Enter it in Settings.');
  }
  return null;
}
