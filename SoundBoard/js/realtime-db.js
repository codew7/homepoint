import { db } from './firebase-init.js';

const audiosRef = () => db.ref('audios');
const audioRef = (id) => db.ref(`audios/${id}`);

export function listenAudios(callback) {
  const ref = audiosRef();
  const handler = ref.on('value', (snap) => {
    const val = snap.val() || {};
    const list = Object.entries(val).map(([id, data]) => ({ id, ...data }));
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    callback(list);
  });
  return () => ref.off('value', handler);
}

export function createAudio(data) {
  const ref = audiosRef().push();
  const payload = {
    name: data.name,
    description: data.description || '',
    storageUrl: data.storageUrl,
    fileName: data.fileName,
    storagePath: data.storagePath,
    duration: data.duration || 0,
    isActive: true,
    volume: typeof data.volume === 'number' ? data.volume : 0.8,
    color: data.color || '#6366F1',
    schedules: data.schedules || [],
    createdAt: Date.now()
  };
  return ref.set(payload).then(() => ref.key);
}

export function updateAudio(id, patch) {
  return audioRef(id).update(patch);
}

export function deleteAudioNode(id) {
  return audioRef(id).remove();
}

export async function isNameTaken(name) {
  const snap = await audiosRef().once('value');
  const val = snap.val() || {};
  return Object.values(val).some(a => (a.name || '').trim().toLowerCase() === name.trim().toLowerCase());
}

// Play history is no longer persisted. See js/play-log.js (in-memory only).
