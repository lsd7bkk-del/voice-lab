// On-device pitch + level analysis. Normalized autocorrelation, 70–450 Hz,
// first-peak selection (avoids octave-down errors), parabolic interpolation.
export function analyseFrame(buf, sr) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return { rms, pitch: -1 };
  const minLag = Math.floor(sr / 450), maxLag = Math.min(Math.floor(sr / 70), n - 2);
  const win = n - maxLag, rs = new Float32Array(maxLag + 2);
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < win; i++) { const a = buf[i], b = buf[i + lag]; s += a * b; e1 += a * a; e2 += b * b; }
    rs[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
    if (rs[lag] > best) best = rs[lag];
  }
  if (best < 0.6) return { rms, pitch: -1 };
  let pick = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (rs[lag] >= 0.9 * best && rs[lag] >= rs[lag - 1] && rs[lag] >= rs[lag + 1]) { pick = lag; break; }
  }
  if (pick < 0) return { rms, pitch: -1 };
  const y0 = rs[pick - 1], y1 = rs[pick], y2 = rs[pick + 1], den = y0 - 2 * y1 + y2;
  const shift = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
  return { rms, pitch: sr / (pick + shift) };
}
