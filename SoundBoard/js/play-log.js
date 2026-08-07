// In-memory recent play history. NOT persisted — lives only for the current
// session/tab and resets on reload. Same API shape as the old DB-backed
// version so call sites (app.js, scheduler.js) stay unchanged.
const MAX_ENTRIES = 10;
const entries = [];
const listeners = new Set();

export function logPlay(audio, triggeredBy = 'manual') {
  entries.unshift({
    audioId: audio.id,
    audioName: audio.name,
    color: audio.color,
    playedAt: Date.now(),
    triggeredBy
  });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  emit();
}

export function listenPlayLog(callback) {
  listeners.add(callback);
  callback(entries.slice());
  return () => listeners.delete(callback);
}

function emit() {
  const snapshot = entries.slice();
  listeners.forEach(cb => {
    try { cb(snapshot); } catch (e) { console.error(e); }
  });
}
