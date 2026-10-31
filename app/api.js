// Backend client. With no backend address set, runs in Demo mode:
// transcripts are canned and marked simulated, and nothing leaves the phone.

import { settings } from './store.js';
import { mockTranscription } from '../lib/mock.js';

export class ApiError extends Error {
  constructor(code, message, { retryable = false, status = 0 } = {}) {
    super(message);
    this.code = code; this.retryable = retryable; this.status = status;
  }
}

const base = () => (settings.get().backendUrl || '').trim().replace(/\/+$/, '');
export const isDemo = () => !base();

async function call(path, init = {}) {
  const s = settings.get();
  const headers = { ...(init.headers || {}) };
  if (s.accessCode) headers['x-access-code'] = s.accessCode;
  let res;
  try {
    res = await fetch(base() + path, { ...init, headers });
  } catch {
    throw new ApiError('network', 'Could not reach the backend. Check your connection and the backend address in Settings.', { retryable: true });
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = body && body.error;
    throw new ApiError(e?.code || `http_${res.status}`, e?.message || `Backend returned ${res.status}.`, {
      retryable: Boolean(e?.retryable) || res.status >= 500, status: res.status,
    });
  }
  return body;
}

export async function getStatus() {
  if (isDemo()) {
    return { mode: 'demo', transcription: { provider: 'demo', configured: true }, coach: { provider: 'none', configured: false }, accessCodeSet: false, accessRequired: false };
  }
  return call('/api/status');
}

export async function transcribe(blob, { duration }) {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 600));
    return { ...mockTranscription(duration), provider: 'demo' };
  }
  return call('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/mp4', 'x-duration-seconds': String(duration || '') },
    body: blob,
  });
}
