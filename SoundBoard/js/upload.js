import { storage } from './firebase-init.js';
import { createAudio, isNameTaken } from './realtime-db.js';

const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED_EXT = ['mp3', 'wav', 'ogg', 'm4a'];

const state = {
  file: null,
  duration: 0,
  objectUrl: null,
  color: '#6366F1',
  uploading: false
};

function $(sel) { return document.querySelector(sel); }

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('removing');
    setTimeout(() => t.remove(), 250);
  }, duration);
}

function setupDropzone() {
  const zone = $('#upload-zone');
  const input = $('#file-input');
  const browse = $('#browse-btn');

  zone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    input.click();
  });
  browse.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev => {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('dragging'); });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });
}

function validateFile(file) {
  if (!file) return 'No se seleccionó archivo';
  if (!file.type.startsWith('audio/')) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return 'El archivo debe ser de audio (MP3, WAV, OGG, M4A)';
  }
  if (file.size > MAX_SIZE) return 'El archivo supera el límite de 20MB';
  if (file.size === 0) return 'El archivo está vacío';
  return null;
}

function handleFile(file) {
  const err = validateFile(file);
  if (err) {
    showToast(err, 'error');
    return;
  }
  state.file = file;

  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);

  const preview = $('#preview-audio');
  preview.src = state.objectUrl;
  preview.onloadedmetadata = () => {
    state.duration = preview.duration || 0;
    $('#preview-meta').textContent = `${formatSize(file.size)} · ${formatDuration(state.duration)}`;
  };

  $('#preview-filename').textContent = file.name;
  $('#preview-meta').textContent = formatSize(file.size);
  $('#preview-section').hidden = false;
  $('#upload-zone').hidden = true;

  // Pre-fill name from filename
  const nameInput = $('#audio-name');
  if (!nameInput.value) {
    const base = file.name.replace(/\.[^.]+$/, '');
    nameInput.value = base;
  }
}

function clearFile() {
  state.file = null;
  state.duration = 0;
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  $('#preview-section').hidden = true;
  $('#upload-zone').hidden = false;
  $('#file-input').value = '';
  $('#upload-form').reset();
  $('#progress-wrapper').hidden = true;
}

function setupForm() {
  $('#clear-file').addEventListener('click', clearFile);
  $('#cancel-upload').addEventListener('click', clearFile);

  $('#color-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-color]');
    if (!btn) return;
    document.querySelectorAll('#color-picker button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.color = btn.dataset.color;
  });

  const volSlider = $('#initial-volume');
  const volDisplay = $('#volume-display');
  volSlider.addEventListener('input', (e) => {
    volDisplay.textContent = `${e.target.value}%`;
  });

  $('#upload-form').addEventListener('submit', handleSubmit);
}

async function handleSubmit(e) {
  e.preventDefault();
  if (state.uploading) return;
  if (!state.file) {
    showToast('Seleccioná un archivo primero', 'error');
    return;
  }
  const name = $('#audio-name').value.trim();
  if (!name) {
    showToast('El nombre es obligatorio', 'error');
    return;
  }

  try {
    state.uploading = true;
    setSubmitting(true);

    if (await isNameTaken(name)) {
      showToast('Ya existe un audio con ese nombre', 'error');
      state.uploading = false;
      setSubmitting(false);
      return;
    }

    const description = $('#audio-description').value.trim();
    const volume = Number($('#initial-volume').value) / 100;
    const file = state.file;
    const timestamp = Date.now();
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
    const sanitized = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'audio';
    const path = `audios/${timestamp}_${sanitized}.${ext}`;
    const ref = storage.ref(path);

    $('#progress-wrapper').hidden = false;
    const fill = $('#progress-fill');
    const text = $('#progress-text');

    const task = ref.put(file, { contentType: file.type || `audio/${ext}` });

    await new Promise((resolve, reject) => {
      task.on('state_changed',
        snapshot => {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          fill.style.width = `${pct}%`;
          text.textContent = `${pct}%`;
        },
        err => reject(err),
        () => resolve()
      );
    });

    const downloadUrl = await task.snapshot.ref.getDownloadURL();

    await createAudio({
      name,
      description,
      storageUrl: downloadUrl,
      fileName: file.name,
      storagePath: path,
      duration: Math.round(state.duration || 0),
      volume,
      color: state.color,
      schedules: []
    });

    showToast('¡Audio subido correctamente!', 'success');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 900);
  } catch (err) {
    console.error(err);
    showToast('Error al subir: ' + (err.message || 'desconocido'), 'error');
    setSubmitting(false);
    state.uploading = false;
  }
}

function setSubmitting(isSubmitting) {
  const btn = $('#submit-upload');
  btn.disabled = isSubmitting;
  $('#cancel-upload').disabled = isSubmitting;
  $('#audio-name').disabled = isSubmitting;
  $('#audio-description').disabled = isSubmitting;
  $('#initial-volume').disabled = isSubmitting;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(s) {
  if (!s || isNaN(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

setupDropzone();
setupForm();
