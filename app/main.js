// Voice Lab — phone app. One screen at a time, rendered from state.
// Phase 1: articulation practice → record → review → transcribe → measured delivery metrics.

import { sessions, audio as audioStore, settings, deleteAllData, uid } from './store.js';
import { startRecording, recorderSupport, micErrorMessage } from './recorder.js';
import { getStatus, transcribe, isDemo, ApiError } from './api.js';
import { computeMetrics, FILLERS, HEURISTIC_CANDIDATES } from '../lib/metrics.js';
import { ARTICULATION_PROMPTS, pickPrompt, promptById } from '../lib/prompts.js';

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('backBtn');
const $pill = document.getElementById('modePill');

/* ---------- tiny DOM helper (text is always set as text, never HTML) ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') throw new Error('no innerHTML');
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------- navigation ---------- */
const stack = [];
let current = null;
function go(screen, params = {}, { replace = false } = {}) {
  if (current && current.cleanup) current.cleanup();
  if (current && !replace) stack.push({ screen: current.screen, params: current.params });
  current = { screen, params };
  render();
}
function back() {
  if (current && current.cleanup) current.cleanup();
  const prev = stack.pop();
  current = prev || { screen: 'home', params: {} };
  render();
}
$back.addEventListener('click', back);
document.getElementById('settingsBtn').addEventListener('click', () => { if (current?.screen !== 'settings') go('settings'); });

function render() {
  const s = SCREENS[current.screen];
  $app.textContent = '';
  $back.hidden = current.screen === 'home';
  const view = s(current.params, current);
  $title.textContent = view.title;
  $app.append(view.node);
  window.scrollTo(0, 0);
}

/* ---------- mode pill ---------- */
async function refreshPill() {
  $pill.className = 'mode-pill off'; $pill.textContent = '…';
  try {
    const st = await getStatus();
    if (st.mode === 'demo') { $pill.className = 'mode-pill mock'; $pill.textContent = 'Demo'; }
    else if (st.mode === 'mock') { $pill.className = 'mode-pill mock'; $pill.textContent = 'Test'; }
    else { $pill.className = 'mode-pill live'; $pill.textContent = 'Live'; }
    return st;
  } catch {
    $pill.className = 'mode-pill off'; $pill.textContent = 'Offline';
    return null;
  }
}

/* ======================= SCREENS ======================= */
const SCREENS = {};

/* ---------- Home ---------- */
SCREENS.home = () => {
  const node = h('section', { class: 'screen' });
  const recentList = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Loading…'));

  node.append(
    h('div', { class: 'card' },
      h('div', { class: 'label' }, 'Articulation'),
      h('h2', {}, 'Say it clearly, in the time you have'),
      h('p', { class: 'muted' }, 'A random prompt, a 30–90 second answer, then your pace, pauses, fillers and pitch, measured from your recording.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'startArt', onclick: () => go('practice') }, 'Start a drill')),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'label' }, 'Next phases'),
      h('div', { class: 'list' },
        ...[['Coach feedback, retry and compare', 'Phase 2'], ['Persuasion', 'Phase 3'], ['Negotiation roleplay', 'Phase 4'], ['Objections and closing', 'Phase 5']]
          .map(([t, p]) => h('div', { class: 'status-line' }, h('span', {}, t), h('span', { class: 'chip' }, p))),
      ),
    ),
    h('div', { class: 'row' }, h('div', { class: 'group-title grow' }, 'Recent'), h('button', { class: 'btn', onclick: () => go('history') }, 'All history')),
    recentList,
  );

  sessions.all().then((list) => {
    recentList.textContent = '';
    if (!list.length) { recentList.append(h('div', { class: 'empty' }, 'No drills yet. Your first one will show up here.')); return; }
    list.slice(0, 3).forEach((s) => recentList.append(sessionItem(s)));
  }).catch(() => { recentList.textContent = ''; recentList.append(h('div', { class: 'empty' }, 'History is unavailable in this browser mode.')); });

  return { title: 'Voice Lab', node };
};

function sessionItem(s) {
  const p = promptById(s.scenario_id);
  const a = s.attempts?.[s.attempts.length - 1];
  const pace = a?.metrics?.metrics?.find((m) => m.id === 'speaking_rate')?.value ?? a?.metrics?.metrics?.find((m) => m.id === 'overall_wpm')?.value;
  const sub = [fmtDate(s.created_at), a?.modality === 'typed' ? 'typed' : pace != null ? `${pace} wpm` : null, a?.status === 'needs_transcription' ? 'not transcribed' : null, a?.simulated ? 'demo' : null].filter(Boolean).join(' · ');
  return h('button', { class: 'item', onclick: () => go('result', { sessionId: s.id }) },
    h('div', { class: 'body' }, h('div', { class: 't' }, p ? p.title : 'Drill'), h('div', { class: 's' }, sub)),
    h('span', { 'aria-hidden': 'true' }, '›'));
}

/* ---------- Practice: prompt → record → review → submit ---------- */
SCREENS.practice = (params, cur) => {
  const node = h('section', { class: 'screen' });
  const recent = params.recent || [];
  const prompt = params.promptId ? promptById(params.promptId) : pickPrompt(recent);
  const state = { phase: 'ready', take: null, rec: null, promptShownAt: Date.now(), typed: false, url: null };
  cur.params = { ...params, promptId: prompt.id }; // keep the same prompt if we come back here

  const supp = recorderSupport();
  const timer = h('div', { class: 'timer' }, '0:00');
  const target = h('div', { class: 'muted' }, `Target ${prompt.seconds} s`);
  const meterFill = h('i');
  const canvas = h('canvas', { class: 'trace', width: 600, height: 80, 'aria-label': 'Live pitch trace' });
  const recBtn = h('button', { class: 'rec-btn', id: 'recBtn', 'aria-label': 'Start recording' }, 'REC');
  const msg = h('div');
  const review = h('div', { class: 'card', hidden: true });
  const typedCard = h('div', { class: 'card', hidden: true });

  node.append(
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'label grow' }, prompt.title), h('span', { class: 'chip' }, `${prompt.seconds} s`)),
      h('p', { class: 'prompt' }, prompt.text),
      h('p', { class: 'muted' }, `Optional scaffold: ${prompt.tip}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => go('practice', { recent: [...recent, prompt.id].slice(-5) }, { replace: true }) }, 'Different prompt'),
        h('button', { class: 'btn', id: 'typeInstead', onclick: () => showTyped() }, 'Type instead'),
      ),
    ),
    h('div', { class: 'card', id: 'recCard' },
      h('div', { class: 'rec-stage' }, recBtn, timer, target),
      h('div', { class: 'meter', 'aria-hidden': 'true' }, meterFill),
      canvas,
      msg,
    ),
    review,
    typedCard,
  );

  if (!supp.secure || !supp.mic || !supp.recorder) {
    msg.replaceChildren(h('div', { class: 'banner warn' }, 'Recording is not available in this browser. You can still type your answer.'));
    recBtn.disabled = true;
  }

  // live pitch trace
  const trace = [];
  const cctx = canvas.getContext('2d');
  function draw() {
    const w = canvas.width, hgt = canvas.height, cs = getComputedStyle(document.documentElement);
    cctx.clearRect(0, 0, w, hgt);
    cctx.fillStyle = cs.getPropertyValue('--meter').trim() || '#2d4a7a';
    const step = w / 160;
    trace.forEach((p, i) => {
      if (p <= 0) return;
      const y = hgt - ((Math.min(450, Math.max(70, p)) - 70) / 380) * hgt;
      cctx.beginPath(); cctx.arc(i * step + step / 2, y, 2.2, 0, Math.PI * 2); cctx.fill();
    });
  }
  draw();

  async function start() {
    msg.textContent = '';
    try {
      state.rec = await startRecording({
        onFrame: (f) => {
          const db = f.rms > 0 ? Math.max(-60, 20 * Math.log10(f.rms)) : -60;
          meterFill.style.width = `${Math.round(((db + 60) / 60) * 100)}%`;
          timer.textContent = fmtTime(f.elapsed);
          trace.push(f.pitch); if (trace.length > 160) trace.shift();
          draw();
        },
      });
      state.phase = 'recording';
      recBtn.classList.add('on'); recBtn.textContent = 'STOP'; recBtn.setAttribute('aria-label', 'Stop recording');
      review.hidden = true;
    } catch (err) {
      msg.replaceChildren(h('div', { class: 'banner err' }, micErrorMessage(err)));
    }
  }
  async function stop() {
    const take = await state.rec.stop();
    state.rec = null;
    state.take = take;
    state.phase = 'review';
    recBtn.classList.remove('on'); recBtn.textContent = 'REC'; recBtn.setAttribute('aria-label', 'Record again');
    meterFill.style.width = '0%';
    showReview();
  }
  recBtn.addEventListener('click', () => (state.phase === 'recording' ? stop() : start()));

  function showReview() {
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(state.take.blob);
    const tooShort = state.take.duration < 3;
    review.hidden = false;
    review.replaceChildren(
      h('div', { class: 'label' }, 'Review before you submit'),
      h('audio', { controls: true, src: state.url }),
      h('p', { class: 'muted' }, `${state.take.duration.toFixed(1)} s recorded.${tooShort ? ' That is very short — most metrics need at least 5 s.' : ''} Listen back, or tap REC to record again.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', id: 'submitTake', onclick: submitVoice }, 'Submit'),
        h('button', { class: 'btn', onclick: () => { review.hidden = true; state.take = null; timer.textContent = '0:00'; } }, 'Discard'),
      ),
    );
  }

  function showTyped() {
    if (state.rec) return;
    typedCard.hidden = false;
    const ta = h('textarea', { id: 'typedAnswer', rows: 6, style: 'width:100%;min-height:140px;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--sunk);font:inherit;color:inherit;resize:vertical', placeholder: 'Write your answer as you would say it.' });
    typedCard.replaceChildren(
      h('div', { class: 'label' }, 'Typed answer'),
      h('p', { class: 'muted' }, 'Typed answers get content feedback only (from Phase 2). Pace, pauses and pitch are not measured.'),
      ta,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'submitTyped', onclick: () => submitTyped(ta.value) }, 'Submit typed answer')),
    );
    ta.focus();
  }

  async function submitTyped(text) {
    text = String(text || '').trim();
    if (!text) return;
    const session = newSession(prompt, 'typed');
    const attempt = {
      id: uid('att'), seq: 1, created_at: Date.now(), modality: 'typed', status: 'complete',
      transcript_raw: text, transcription: null, client: { promptShownAt: state.promptShownAt },
      metrics: computeMetrics({ modality: 'typed' }),
    };
    session.attempts.push(attempt);
    session.status = 'complete';
    await sessions.put(session);
    go('result', { sessionId: session.id }, { replace: true });
  }

  async function submitVoice() {
    const take = state.take;
    if (!take) return;
    const btn = document.getElementById('submitTake');
    btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), 'Saving…');
    const session = newSession(prompt, 'voice');
    const attempt = {
      id: uid('att'), seq: 1, created_at: Date.now(), modality: 'voice', status: 'needs_transcription',
      duration: take.duration, mime: take.mime,
      client: { promptShownAt: state.promptShownAt, recordStartedAt: take.startedAt, recordDuration: take.duration },
      signal: take.signal, audio_id: uid('aud'),
      transcript_raw: null, transcription: null, metrics: null,
    };
    // Save the take locally FIRST, so a failed upload never loses it (AT-13).
    await audioStore.put(attempt.audio_id, take.blob);
    session.attempts.push(attempt);
    await sessions.put(session);
    go('result', { sessionId: session.id, autoTranscribe: true }, { replace: true });
  }

  return { title: 'Articulation', node, cleanup: () => { if (state.rec) state.rec.cancel(); if (state.url) URL.revokeObjectURL(state.url); } };
};

function newSession(prompt, modality) {
  return { id: uid('ses'), mode: 'articulation', scenario_id: prompt.id, modality, created_at: Date.now(), status: 'in_progress', attempts: [] };
}

/* ---------- Transcription step (runs on the result screen, retryable) ---------- */
async function runTranscription(session, attempt) {
  const blob = await audioStore.get(attempt.audio_id);
  if (!blob) throw new ApiError('audio_missing', 'The recording for this attempt is no longer on this phone.');
  const t = await transcribe(blob, { duration: attempt.duration });
  attempt.transcription = t;
  attempt.transcript_raw = t.text;
  attempt.simulated = Boolean(t.simulated);
  attempt.metrics = computeMetrics({ modality: 'voice', transcription: t, client: attempt.client, signal: attempt.signal });
  attempt.status = 'complete';
  session.status = 'complete';
  // Retention OFF by default: drop the audio once it has been transcribed (spec §2).
  if (!settings.get().keepRecordings) {
    await audioStore.remove(attempt.audio_id);
    attempt.audio_id = null;
  }
  await sessions.put(session);
}

/* ---------- Result ---------- */
SCREENS.result = (params, cur) => {
  const node = h('section', { class: 'screen' });
  node.append(h('div', { class: 'empty' }, 'Loading…'));
  let alive = true;

  (async () => {
    const session = await sessions.get(params.sessionId);
    if (!alive) return;
    if (!session) { node.replaceChildren(h('div', { class: 'empty' }, 'This drill was deleted.')); return; }
    const attempt = session.attempts[session.attempts.length - 1];
    const prompt = promptById(session.scenario_id);

    const head = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'label grow' }, prompt ? prompt.title : 'Drill'), h('span', { class: 'chip' }, fmtDate(session.created_at))),
      h('p', {}, prompt ? prompt.text : ''),
    );
    node.replaceChildren(head);

    if (attempt.status === 'needs_transcription') {
      const box = h('div', { class: 'card' });
      node.append(box);
      const attemptRun = async () => {
        box.replaceChildren(h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', {}, isDemo() ? 'Making a demo transcript…' : 'Transcribing…')));
        try {
          await runTranscription(session, attempt);
          if (alive) go('result', { sessionId: session.id }, { replace: true });
        } catch (err) {
          if (!alive) return;
          box.replaceChildren(
            h('div', { class: 'banner err' }, err.message || 'Transcription failed.'),
            h('p', { class: 'muted' }, 'Your recording is saved on this phone. Nothing was lost.'),
            h('div', { class: 'row' },
              h('button', { class: 'btn primary', id: 'retryTranscribe', onclick: attemptRun }, 'Try again'),
              h('button', { class: 'btn', onclick: () => go('settings') }, 'Settings')),
          );
        }
      };
      if (params.autoTranscribe) { cur.params = { sessionId: session.id }; attemptRun(); }
      else box.replaceChildren(h('p', { class: 'muted' }, 'This recording has not been transcribed yet.'), h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'retryTranscribe', onclick: attemptRun }, 'Transcribe now')));
      node.append(deleteSessionCard(session));
      return;
    }

    if (attempt.simulated) {
      node.append(h('div', { class: 'banner warn', id: 'simBanner' }, 'Sample transcript: the words below are a canned test sample, not what you said. Pitch and volume come from your real recording; pace, pauses and fillers come from the sample. Add a backend in Settings for real transcripts.'));
    }

    // Recording (only if kept)
    if (attempt.audio_id) {
      const blob = await audioStore.get(attempt.audio_id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        cur.cleanup = () => URL.revokeObjectURL(url);
        node.append(h('div', { class: 'card' }, h('div', { class: 'label' }, 'Recording'), h('audio', { controls: true, src: url })));
      }
    }

    node.append(metricsCard(attempt), transcriptCard(session, attempt));
    node.append(h('div', { class: 'card' },
      h('div', { class: 'label' }, 'Coach feedback'),
      h('p', { class: 'muted' }, 'Rubric ratings with quotes from your answer, a targeted drill and retry-and-compare come in Phase 2. Everything above is measured, not judged.')));
    node.append(h('div', { class: 'row' },
      h('button', { class: 'btn primary', id: 'nextDrill', onclick: () => go('practice', { recent: [session.scenario_id] }) }, 'Next drill'),
      h('button', { class: 'btn', onclick: () => go('home') }, 'Home')));
    node.append(deleteSessionCard(session));
  })().catch((err) => { if (alive) node.replaceChildren(h('div', { class: 'banner err' }, `Could not open this drill: ${err.message}`)); });

  return { title: 'Result', node, cleanup: () => { alive = false; } };
};

const METRIC_GROUPS = [
  ['Pace and pauses', ['speaking_rate', 'overall_wpm', 'pause_count', 'pause_median', 'longest_run', 'response_latency']],
  ['Fillers', ['filler_count', 'filler_rate']],
  ['Voice', ['pitch_median', 'pitch_variation', 'level_steadiness']],
  ['Conversation', ['talk_time_share']],
];

function metricsCard(attempt) {
  const card = h('div', { class: 'card', id: 'metricsCard' }, h('div', { class: 'label' }, 'Measured delivery'));
  const ms = attempt.metrics?.metrics || [];
  if (attempt.modality === 'typed') {
    card.append(h('p', { class: 'muted' }, 'Typed answer: vocal delivery is not measured, so there are no pace, pause or pitch numbers.'));
    return card;
  }
  for (const [title, ids] of METRIC_GROUPS) {
    const items = ids.map((id) => ms.find((m) => m.id === id)).filter(Boolean);
    if (!items.length) continue;
    card.append(h('div', { class: 'group-title' }, title));
    card.append(h('div', { class: 'metrics' }, ...items.map((m) => {
      const na = m.value == null;
      return h('div', { class: `metric${na ? ' na' : ''}`, 'data-metric': m.id },
        h('div', { class: 'k' }, m.label),
        h('div', { class: 'v' }, na ? '—' : String(m.id === 'talk_time_share' ? Math.round(m.value * 100) : m.value), !na && m.unit ? h('small', {}, m.unit) : null),
        h('div', { class: 'n' }, na ? m.reason : m.note || ''));
    })));
  }
  const cands = attempt.metrics?.candidates || {};
  const keys = Object.keys(cands);
  card.append(h('p', { class: 'muted' }, keys.length
    ? `Possible verbal habits (not counted as fillers): ${keys.map((k) => `“${k}” ×${cands[k]}`).join(', ')}. Often fine in context; listen back and decide.`
    : 'No common verbal-habit phrases spotted.'));
  return card;
}

function transcriptCard(session, attempt) {
  const card = h('div', { class: 'card' });
  const words = attempt.transcription?.words;
  const body = h('div', { class: 'transcript', id: 'transcript' });
  if (words && words.length) {
    const norm = (w) => String(w || '').toLowerCase().replace(/[^a-z'\-]/g, '');
    const singles = HEURISTIC_CANDIDATES.filter((c) => !c.includes(' '));
    words.forEach((w, i) => {
      const n = norm(w.word);
      const text = w.display || w.word;
      if (FILLERS.includes(n)) body.append(h('mark', { title: 'Filler' }, text));
      else if (singles.includes(n)) body.append(h('mark', { class: 'cand', title: 'Possible verbal habit' }, text));
      else body.append(text);
      if (i < words.length - 1) body.append(' ');
    });
  } else body.append(attempt.transcript_raw || '');

  const corrected = attempt.transcript_corrected;
  card.append(
    h('div', { class: 'row' }, h('div', { class: 'label grow' }, attempt.modality === 'typed' ? 'Your answer' : 'Transcript'),
      attempt.modality === 'voice' ? h('span', { class: 'chip' }, 'red = filler · dotted = possible habit') : null),
    body,
  );
  if (attempt.modality === 'voice') {
    const editBox = h('div', { hidden: true, class: 'field' });
    if (corrected) card.append(h('div', { class: 'field' }, h('div', { class: 'label' }, 'Your correction'), h('p', {}, corrected)));
    card.append(
      h('p', { class: 'muted' }, 'If a word was misheard, correct it. Corrections help the coach later but never change the measured numbers.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { editBox.hidden = false; } }, corrected ? 'Edit correction' : 'Correct transcript')),
      editBox,
    );
    const ta = h('textarea', { rows: 5, style: 'width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--sunk);font:inherit;color:inherit' });
    ta.value = corrected || attempt.transcript_raw || '';
    editBox.append(ta, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => {
      attempt.transcript_corrected = ta.value.trim() || null;
      await sessions.put(session);
      go('result', { sessionId: session.id }, { replace: true });
    } }, 'Save correction')));
  }
  return card;
}

function deleteSessionCard(session) {
  const box = h('div', {});
  const ask = () => box.replaceChildren(h('div', { class: 'confirm' },
    h('div', {}, 'Delete this drill and its recording from this phone? This cannot be undone.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', id: 'confirmDelete', onclick: async () => { await sessions.remove(session.id); go('home', {}, { replace: true }); stack.length = 0; } }, 'Delete'),
      h('button', { class: 'btn', onclick: idle }, 'Keep it'))));
  const idle = () => box.replaceChildren(h('div', { class: 'row' }, h('button', { class: 'btn danger', id: 'deleteSession', onclick: ask }, 'Delete this drill')));
  idle();
  return box;
}

/* ---------- History ---------- */
SCREENS.history = () => {
  const node = h('section', { class: 'screen' });
  const list = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Loading…'));
  node.append(list);
  sessions.all().then((all) => {
    list.textContent = '';
    if (!all.length) list.append(h('div', { class: 'empty' }, 'No drills yet.'));
    all.forEach((s) => list.append(sessionItem(s)));
  });
  return { title: 'History', node };
};

/* ---------- Settings ---------- */
SCREENS.settings = () => {
  const s = settings.get();
  const node = h('section', { class: 'screen' });
  const statusBox = h('div', { class: 'list', id: 'statusBox' }, h('div', { class: 'muted' }, 'Checking…'));
  const url = h('input', { type: 'text', id: 'backendUrl', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Empty = Demo mode' });
  url.value = s.backendUrl;
  const code = h('input', { type: 'password', id: 'accessCode', autocomplete: 'off', placeholder: 'Set on the server' });
  code.value = s.accessCode;
  const keep = h('input', { type: 'checkbox', id: 'keepRecordings' });
  keep.checked = s.keepRecordings;
  keep.addEventListener('change', () => settings.set({ keepRecordings: keep.checked }));

  async function check() {
    statusBox.replaceChildren(h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { class: 'muted' }, 'Checking…')));
    const st = await refreshPill();
    if (!st) { statusBox.replaceChildren(h('div', { class: 'banner err' }, 'Could not reach the backend at that address.')); return; }
    const line = (k, ok, v) => h('div', { class: 'status-line' }, h('span', {}, k), h('span', { class: `chip` }, `${ok ? '✓' : '✗'} ${v}`));
    const lines = [
      line('Mode', true, st.mode === 'demo' ? 'Demo (no backend)' : st.mode === 'mock' ? 'Test provider' : 'Live'),
      line('Transcription', st.transcription.configured, st.transcription.configured ? st.transcription.provider : 'missing'),
      line('Coach', st.coach.configured, st.coach.configured ? st.coach.provider : st.mode === 'demo' ? 'needs backend' : 'missing'),
    ];
    if (st.mode !== 'demo') lines.push(line('Access code on server', st.accessCodeSet, st.accessCodeSet ? 'set' : 'not set'));
    statusBox.replaceChildren(...lines);
  }

  const deleteBox = h('div', {});
  const idle = () => deleteBox.replaceChildren(h('button', { class: 'btn danger', id: 'deleteAll', onclick: ask }, 'Delete all data'));
  const ask = () => deleteBox.replaceChildren(h('div', { class: 'confirm' },
    h('div', {}, 'Delete every drill, transcript and recording on this phone? Settings are kept. This cannot be undone.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', id: 'confirmDeleteAll', onclick: async () => { await deleteAllData(); deleteBox.replaceChildren(h('div', { class: 'banner ok' }, 'All drills and recordings deleted.')); } }, 'Delete everything'),
      h('button', { class: 'btn', onclick: idle }, 'Cancel'))));
  idle();

  node.append(
    h('div', { class: 'card' },
      h('div', { class: 'label' }, 'Backend'),
      h('div', { class: 'field' }, h('label', { for: 'backendUrl' }, 'Backend address'), url),
      h('div', { class: 'field' }, h('label', { for: 'accessCode' }, 'Access code'), code),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'saveBackend', onclick: () => { settings.set({ backendUrl: url.value.trim(), accessCode: code.value }); check(); } }, 'Save and check')),
      statusBox,
      h('p', { class: 'muted' }, 'Provider keys live only on the server. This screen shows whether they are configured, never their values.'),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'label' }, 'Privacy'),
      h('label', { class: 'toggle', for: 'keepRecordings' }, h('span', {}, 'Keep recordings after transcription'), keep),
      h('p', { class: 'muted' }, 'Off by default: each recording is deleted from this phone once it has been transcribed. Drills, transcripts and numbers are stored only on this phone. With a backend set, your audio is sent to the transcription service to be turned into text, and nothing else.'),
    ),
    h('div', { class: 'card' }, h('div', { class: 'label' }, 'Data'), deleteBox),
    h('p', { class: 'muted' }, h('a', { href: 'check.html' }, 'Run the device check')),
  );
  check();
  return { title: 'Settings', node };
};

/* ---------- boot ---------- */
current = { screen: 'home', params: {} };
render();
refreshPill();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__voiceLab = { go, settings, ARTICULATION_PROMPTS };
