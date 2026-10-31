// Local storage on the phone. IndexedDB for sessions and audio; localStorage for small settings.
const DB_NAME = 'voicelab';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const sessions = {
  put: (s) => tx('sessions', 'readwrite', (st) => st.put(s)),
  get: (id) => tx('sessions', 'readonly', (st) => st.get(id)),
  all: async () => {
    const list = await tx('sessions', 'readonly', (st) => st.getAll());
    return (list || []).sort((a, b) => b.created_at - a.created_at);
  },
  async remove(id) {
    const s = await sessions.get(id);
    if (s) for (const a of s.attempts || []) if (a.audio_id) await audio.remove(a.audio_id);
    await tx('sessions', 'readwrite', (st) => st.delete(id));
  },
};

export const audio = {
  put: (id, blob) => tx('audio', 'readwrite', (st) => st.put({ id, blob })),
  get: async (id) => (await tx('audio', 'readonly', (st) => st.get(id)))?.blob || null,
  remove: (id) => tx('audio', 'readwrite', (st) => st.delete(id)),
};

export async function deleteAllData() {
  await tx('sessions', 'readwrite', (st) => st.clear());
  await tx('audio', 'readwrite', (st) => st.clear());
}

const SETTINGS_KEY = 'voicelab.settings';
// keepRecordings is OFF by default (spec §2): audio is deleted once transcribed.
// backendUrl empty = Demo mode (canned transcripts, nothing leaves the phone).
const DEFAULTS = { keepRecordings: false, accessCode: '', backendUrl: '' };
export const settings = {
  get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULTS }; }
  },
  set(patch) {
    const next = { ...settings.get(), ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage blocked: settings last for this visit only */ }
    return next;
  },
};
