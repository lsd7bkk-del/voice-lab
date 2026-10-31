// Microphone recorder with live on-device analysis.
// Records compressed audio (MediaRecorder) and, at the same time, samples pitch
// and level every ~90 ms for the delivery metrics and the live trace.

import { analyseFrame } from '../lib/pitch.js';

const MIME_PREFS = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac'];

export function recorderSupport() {
  return {
    mic: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    recorder: typeof window.MediaRecorder !== 'undefined',
    secure: window.isSecureContext,
  };
}

let ctx = null;
function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/**
 * Starts recording. Returns a handle with stop() → Promise<take>.
 * onFrame({rms, pitch, elapsed}) is called for live UI.
 */
export async function startRecording({ onFrame } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  });
  const ac = audioCtx();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);

  const mime = MIME_PREFS.find((m) => window.MediaRecorder?.isTypeSupported?.(m));
  const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const parts = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };

  const signal = { pitchHz: [], rms: [] };
  const buf = new Float32Array(an.fftSize);
  const startedAt = Date.now();
  const t0 = performance.now();
  const tick = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    const f = analyseFrame(buf, ac.sampleRate);
    signal.pitchHz.push(f.pitch > 0 ? Math.round(f.pitch * 10) / 10 : -1);
    signal.rms.push(Math.round(f.rms * 10000) / 10000);
    onFrame && onFrame({ ...f, elapsed: (performance.now() - t0) / 1000 });
  }, 90);
  mr.start(250);

  let stopped = null;
  return {
    startedAt,
    stop() {
      if (stopped) return stopped;
      stopped = new Promise((resolve) => {
        clearInterval(tick);
        const duration = (performance.now() - t0) / 1000;
        const finish = () => {
          try { src.disconnect(); } catch { /* already gone */ }
          stream.getTracks().forEach((t) => t.stop());
          const type = (mr.mimeType || mime || 'audio/mp4').split(';')[0];
          resolve({ blob: new Blob(parts, { type }), mime: type, duration: Math.round(duration * 100) / 100, startedAt, signal });
        };
        if (mr.state !== 'inactive') { mr.onstop = finish; mr.stop(); } else finish();
      });
      return stopped;
    },
    cancel() {
      clearInterval(tick);
      try { mr.state !== 'inactive' && mr.stop(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

export function micErrorMessage(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow it for this site in your phone’s browser settings, then try again.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app. Close it and try again.';
  return `The microphone could not start (${name || 'unknown error'}).`;
}
