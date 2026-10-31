// Cloudflare Worker entry. Routes /api/* to the shared handlers.
// The phone app lives on GitHub Pages (another origin), so this adds CORS
// for the origins listed in ALLOWED_ORIGINS only.

import { handleStatus } from './api/status.js';
import { handleTranscribe } from './api/transcribe.js';
import { errorJson } from './api/_lib/http.js';

const ROUTES = {
  'GET /api/status': (req, env) => handleStatus(env),
  'POST /api/transcribe': (req, env) => handleTranscribe(req, env),
};

export function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function withCors(res, origin) {
  if (!origin) return res;
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', origin);
  h.set('vary', 'origin');
  return new Response(res.body, { status: res.status, headers: h });
}

export async function route(request, env) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);

  if (request.method === 'OPTIONS') {
    if (!origin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-access-code, x-duration-seconds',
        'access-control-max-age': '86400',
        vary: 'origin',
      },
    });
  }
  // Browsers from unlisted origins are refused outright.
  if (request.headers.get('origin') && !origin) return errorJson(403, 'origin_not_allowed', 'This app origin is not allowed.');

  const handler = ROUTES[`${request.method} ${url.pathname}`];
  const res = handler ? await handler(request, env) : errorJson(404, 'not_found', 'No such endpoint.');
  return withCors(res, origin);
}

export default { fetch: (request, env) => route(request, env) };
