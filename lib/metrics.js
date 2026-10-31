// Delivery metrics engine (spec §5). Pure functions, no I/O.
// Runs in the browser and in Node tests.
//
// Every metric is { id, label, value, unit, availability, source, reason, note? }.
// When timing data is missing, value is null with a reason — never zero.

export const PAUSE_THRESHOLD_S = 1.0;        // a silent gap of at least this long counts as a pause
export const MIN_DURATION_FOR_RATE_S = 5;    // below this, rates are too noisy to report

// Conservative disfluencies: counted as fillers.
export const FILLERS = ['um', 'uh', 'erm', 'mhm', 'mhmm', 'hmm'];
// Broader phrases: reported as heuristic candidates only, never asserted as fillers.
export const HEURISTIC_CANDIDATES = ['like', 'you know', 'basically', 'i mean', 'kind of', 'sort of', 'right', 'actually', 'literally', 'so yeah'];

const norm = (w) => String(w || '').toLowerCase().replace(/[^a-z'\-]/g, '');

function metric(id, label, unit, source) {
  return { id, label, unit, source, value: null, availability: 'unavailable', reason: null };
}
function set(m, value, note) {
  m.value = value; m.availability = 'measured'; m.reason = null;
  if (note) m.note = note;
  return m;
}
function unavailable(m, reason) { m.value = null; m.availability = 'unavailable'; m.reason = reason; return m; }

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const round = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Splits timed words into speech segments separated by gaps >= PAUSE_THRESHOLD_S. */
export function speechSegments(words) {
  const segs = [];
  for (const w of words) {
    const last = segs[segs.length - 1];
    if (last && w.start - last.end < PAUSE_THRESHOLD_S) { last.end = Math.max(last.end, w.end); last.words.push(w); }
    else segs.push({ start: w.start, end: w.end, words: [w] });
  }
  return segs;
}

/** Counts multi-word heuristic phrases in a token list. */
export function countCandidates(tokens) {
  const out = {};
  for (const phrase of HEURISTIC_CANDIDATES) {
    const parts = phrase.split(' ');
    let n = 0;
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      if (parts.every((p, j) => tokens[i + j] === p)) n++;
    }
    if (n) out[phrase] = n;
  }
  return out;
}

/**
 * @param {object} input
 * @param {'voice'|'typed'} input.modality
 * @param {object} [input.transcription]  provider output: { text, words:[{word,start,end}], duration, capabilities:{word_timestamps, disfluencies} }
 * @param {object} [input.client]          client timing: { promptShownAt, recordStartedAt, recordDuration }
 * @param {object} [input.signal]          on-device audio analysis: { pitchHz:[...], rms:[...] }
 * @param {boolean} [input.counterpartyMeasured]
 */
export function computeMetrics({ modality, transcription, client = {}, signal = null, counterpartyMeasured = false }) {
  const out = [];
  const T = transcription || {};
  const caps = T.capabilities || {};
  const words = Array.isArray(T.words) ? T.words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)) : [];
  const duration = Number.isFinite(T.duration) && T.duration > 0 ? T.duration : (Number.isFinite(client.recordDuration) ? client.recordDuration : null);

  const mWpm = metric('overall_wpm', 'Overall pace', 'words/min', 'transcript');
  const mRate = metric('speaking_rate', 'Speaking rate', 'words/min', 'audio_timing');
  const mFill = metric('filler_count', 'Fillers (um, uh)', 'count', 'transcript');
  const mFillRate = metric('filler_rate', 'Fillers per minute', 'per min', 'transcript');
  const mPauses = metric('pause_count', 'Pauses ≥ 1 s', 'count', 'audio_timing');
  const mPauseMed = metric('pause_median', 'Median pause', 's', 'audio_timing');
  const mLongest = metric('longest_run', 'Longest run without pausing', 's', 'audio_timing');
  const mLatency = metric('response_latency', 'Time to first word', 's', 'audio_timing');
  const mTalk = metric('talk_time_share', 'Talk-time share', '%', 'audio_timing');
  const mPitchMed = metric('pitch_median', 'Median pitch', 'Hz', 'audio_signal');
  const mPitchVar = metric('pitch_variation', 'Pitch variation', 'semitones', 'audio_signal');
  const mLevel = metric('level_steadiness', 'Volume steadiness', 'dB spread', 'audio_signal');
  const all = [mWpm, mRate, mFill, mFillRate, mPauses, mPauseMed, mLongest, mLatency, mTalk, mPitchMed, mPitchVar, mLevel];

  if (modality === 'typed') {
    all.forEach((m) => unavailable(m, 'Typed answer — vocal delivery is not measured.'));
    return { modality, metrics: all, candidates: {} };
  }

  // Word-based tokens (all words, including fillers) for counting.
  const tokens = (T.words || []).map((w) => norm(w.word));
  const fillerCount = tokens.filter((t) => FILLERS.includes(t)).length;
  const contentWords = tokens.filter((t) => t && !FILLERS.includes(t)).length;
  const candidates = countCandidates(tokens);

  // Pace
  if (!T.words || !T.words.length) {
    unavailable(mWpm, 'No words were transcribed.');
  } else if (duration == null) {
    unavailable(mWpm, 'Recording duration unknown.');
  } else if (duration < MIN_DURATION_FOR_RATE_S) {
    unavailable(mWpm, `Recording shorter than ${MIN_DURATION_FOR_RATE_S} s — too short for a meaningful rate.`);
  } else {
    set(mWpm, round(60 * contentWords / duration), 'Whole recording, including silence. Fillers excluded.');
  }

  // Timing-based metrics
  const haveTiming = caps.word_timestamps && words.length > 0;
  const noTimingReason = !caps.word_timestamps
    ? 'Transcription provider did not return word timings.'
    : 'No timed words in this recording.';
  if (!haveTiming) {
    [mRate, mPauses, mPauseMed, mLongest, mLatency].forEach((m) => unavailable(m, noTimingReason));
  } else {
    const segs = speechSegments(words);
    const speechTime = segs.reduce((s, g) => s + (g.end - g.start), 0);
    const segWords = words.filter((w) => !FILLERS.includes(norm(w.word))).length;
    if (speechTime < MIN_DURATION_FOR_RATE_S) unavailable(mRate, `Less than ${MIN_DURATION_FOR_RATE_S} s of speech — too short for a meaningful rate.`);
    else set(mRate, round(60 * segWords / speechTime), 'Only while speaking; pauses of 1 s or more excluded.');
    const gaps = [];
    for (let i = 1; i < segs.length; i++) gaps.push(segs[i].start - segs[i - 1].end);
    set(mPauses, gaps.length, 'Context only: a deliberate pause before a key point is good.');
    if (gaps.length) set(mPauseMed, round(median(gaps), 1));
    else unavailable(mPauseMed, 'No pauses of 1 s or more.');
    set(mLongest, round(Math.max(...segs.map((g) => g.end - g.start)), 1), 'Long runs often mean breath is being stretched.');
    if (Number.isFinite(client.promptShownAt) && Number.isFinite(client.recordStartedAt)) {
      set(mLatency, round((client.recordStartedAt - client.promptShownAt) / 1000 + words[0].start, 1), 'Reported without judgment — thinking time is fine.');
    } else unavailable(mLatency, 'Prompt timing was not captured for this attempt.');
  }

  // Fillers
  if (!T.words || !T.words.length) {
    unavailable(mFill, 'No words were transcribed.'); unavailable(mFillRate, 'No words were transcribed.');
  } else if (!caps.disfluencies) {
    const r = 'Transcription provider removes fillers, so they cannot be counted.';
    unavailable(mFill, r); unavailable(mFillRate, r);
  } else {
    set(mFill, fillerCount);
    if (duration && duration >= MIN_DURATION_FOR_RATE_S) set(mFillRate, round(60 * fillerCount / duration, 1));
    else unavailable(mFillRate, `Recording shorter than ${MIN_DURATION_FOR_RATE_S} s.`);
  }

  // Talk-time share
  if (!counterpartyMeasured) unavailable(mTalk, 'No measured counterparty speech in this session.');

  // On-device signal metrics
  const pitches = signal && Array.isArray(signal.pitchHz) ? signal.pitchHz.filter((p) => p > 0) : [];
  if (pitches.length < 20) {
    const r = signal ? 'Too little voiced audio was detected for pitch.' : 'On-device audio analysis was not available.';
    unavailable(mPitchMed, r); unavailable(mPitchVar, r);
  } else {
    const med = median(pitches);
    set(mPitchMed, round(med), 'Estimate from autocorrelation.');
    const st = pitches.map((p) => 12 * Math.log2(p / med));
    const mean = st.reduce((a, b) => a + b, 0) / st.length;
    const sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
    set(mPitchVar, round(sd, 1), 'Spread of pitch. Very low often sounds flat; context decides.');
  }
  const rms = signal && Array.isArray(signal.rms) ? signal.rms.filter((r) => r > 0.01) : [];
  if (rms.length < 20) unavailable(mLevel, signal ? 'Too little voiced audio for a volume reading.' : 'On-device audio analysis was not available.');
  else {
    const db = rms.map((r) => 20 * Math.log10(r)).sort((a, b) => a - b);
    const p10 = db[Math.floor(db.length * 0.1)], p90 = db[Math.floor(db.length * 0.9)];
    set(mLevel, round(p90 - p10, 1), 'Gap between your quieter and louder speech. Lower is steadier.');
  }

  return { modality, metrics: all, candidates };
}
