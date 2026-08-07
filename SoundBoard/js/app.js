import { listenAudios, updateAudio, deleteAudioNode } from './realtime-db.js';
import { listenPlayLog, logPlay } from './play-log.js';
import { storage } from './firebase-init.js';
import { audioPlayer } from './audio-player.js';
import { scheduler } from './scheduler.js';
import {
  renderAudioGrid,
  renderStats,
  renderPlayLog,
  refreshAllCardStates,
  showToast
} from './ui.js';

const state = {
  audios: [],
  filter: 'all',
  schedulingAudio: null,
  pendingDelete: null,
  fixedTimes: [],
  daysOfWeek: [1,2,3,4,5,6,0],
  cyclicEnabled: false,
  cyclicInterval: 60
};

function init() {
  setupClock();
  setupMasterVolume();
  setupFilterTabs();
  setupSchedulerModal();
  setupDeleteModal();

  // Listen audios
  listenAudios(audios => {
    state.audios = audios;
    scheduler.syncAudios(audios);
    renderAudioGrid(audios, state.filter, {
      onPlay: (audio) => {
        audioPlayer.play(audio, {
          trigger: 'manual',
          onPlayed: () => logPlay(audio, 'manual')
        });
      },
      onSchedule: (audio) => openSchedulerModal(audio),
      onDelete: (audio) => openDeleteModal(audio)
    });
    renderStats(audios);
  });

  listenPlayLog(entries => renderPlayLog(entries));

  // Player events -> refresh card states
  audioPlayer.onChange((evt) => {
    refreshAllCardStates(state.audios);
    renderStats(state.audios);
    if (evt.type === 'error') {
      showToast('Error al reproducir: ' + evt.error, 'error');
    }
    if (evt.type === 'locked') {
      // A scheduled play could not start (no gesture / context suspended).
      showAudioGate();
    }
  });

  // Refresh "next run" labels every second
  setInterval(() => refreshAllCardStates(state.audios), 1000);

  scheduler.start();

  setupAudioGate();
}

function setupClock() {
  const clock = document.getElementById('status-clock');
  if (!clock) return;
  const tick = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

function setupMasterVolume() {
  const slider = document.getElementById('master-volume');
  const display = document.getElementById('master-volume-value');
  if (!slider || !display) return;
  const initial = Math.round(audioPlayer.getMasterVolume() * 100);
  slider.value = initial;
  display.textContent = `${initial}%`;
  slider.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    display.textContent = `${v}%`;
    audioPlayer.setMasterVolume(v / 100);
  });
}

function setupFilterTabs() {
  document.querySelectorAll('.filter-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.filter = tab.dataset.filter;
      renderAudioGrid(state.audios, state.filter, {
        onPlay: (audio) => audioPlayer.play(audio, { trigger: 'manual', onPlayed: () => logPlay(audio, 'manual') }),
        onSchedule: openSchedulerModal,
        onDelete: openDeleteModal
      });
    });
  });
}

/* ---- Scheduler Modal ---- */

function setupSchedulerModal() {
  const modal = document.getElementById('scheduler-modal');
  if (!modal) return;
  modal.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeScheduler());
  });

  document.getElementById('add-fixed-time').addEventListener('click', () => {
    state.fixedTimes.push('12:00');
    renderFixedTimes();
  });

  document.getElementById('days-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-day]');
    if (!btn) return;
    const day = Number(btn.dataset.day);
    const idx = state.daysOfWeek.indexOf(day);
    if (idx >= 0) state.daysOfWeek.splice(idx, 1);
    else state.daysOfWeek.push(day);
    renderDays();
  });

  document.getElementById('cyclic-enabled').addEventListener('change', (e) => {
    state.cyclicEnabled = e.target.checked;
  });
  document.getElementById('cyclic-interval').addEventListener('input', (e) => {
    state.cyclicInterval = Math.max(1, Number(e.target.value) || 1);
  });

  document.getElementById('save-schedule').addEventListener('click', saveSchedule);
}

function openSchedulerModal(audio) {
  state.schedulingAudio = audio;
  const modal = document.getElementById('scheduler-modal');
  document.getElementById('scheduler-audio-name').textContent = audio.name;

  // Load existing config
  const schedules = audio.schedules || [];
  const fixed = schedules.find(s => s.type === 'fixed');
  const cyclic = schedules.find(s => s.type === 'cyclic');

  state.fixedTimes = fixed && fixed.times ? [...fixed.times] : [];
  state.daysOfWeek = fixed && fixed.daysOfWeek && fixed.daysOfWeek.length ? [...fixed.daysOfWeek] : [1,2,3,4,5,6,0];
  state.cyclicEnabled = !!(cyclic && cyclic.intervalMinutes > 0);
  state.cyclicInterval = cyclic ? cyclic.intervalMinutes : 60;

  document.getElementById('cyclic-enabled').checked = state.cyclicEnabled;
  document.getElementById('cyclic-interval').value = state.cyclicInterval;

  renderFixedTimes();
  renderDays();

  modal.hidden = false;
}

function closeScheduler() {
  const modal = document.getElementById('scheduler-modal');
  modal.hidden = true;
  state.schedulingAudio = null;
}

function renderFixedTimes() {
  const list = document.getElementById('fixed-times-list');
  list.innerHTML = '';
  if (state.fixedTimes.length === 0) {
    list.innerHTML = '<div class="fixed-times-empty">Sin horarios fijos. Añadí uno para programar.</div>';
    return;
  }
  state.fixedTimes.forEach((t, idx) => {
    const row = document.createElement('div');
    row.className = 'fixed-time-row';
    row.innerHTML = `
      <input type="time" value="${t}" />
      <button class="icon-btn danger" type="button" title="Quitar">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    row.querySelector('input').addEventListener('change', (e) => {
      state.fixedTimes[idx] = e.target.value;
    });
    row.querySelector('button').addEventListener('click', () => {
      state.fixedTimes.splice(idx, 1);
      renderFixedTimes();
    });
    list.appendChild(row);
  });
}

function renderDays() {
  document.querySelectorAll('#days-toggle button').forEach(btn => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', state.daysOfWeek.includes(day));
  });
}

async function saveSchedule() {
  if (!state.schedulingAudio) return;
  const schedules = [];

  const validTimes = state.fixedTimes.filter(t => /^\d{2}:\d{2}$/.test(t));
  if (validTimes.length > 0) {
    schedules.push({
      type: 'fixed',
      times: [...new Set(validTimes)].sort(),
      daysOfWeek: state.daysOfWeek.length > 0 ? [...state.daysOfWeek].sort() : [0,1,2,3,4,5,6]
    });
  }

  if (state.cyclicEnabled && state.cyclicInterval > 0) {
    schedules.push({
      type: 'cyclic',
      intervalMinutes: state.cyclicInterval
    });
  }

  try {
    await updateAudio(state.schedulingAudio.id, { schedules });
    showToast('Programación guardada', 'success');
    closeScheduler();
  } catch (err) {
    showToast('No se pudo guardar la programación', 'error');
  }
}

/* ---- Delete confirmation ---- */

function setupDeleteModal() {
  const modal = document.getElementById('confirm-modal');
  if (!modal) return;
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeDeleteModal));
  document.getElementById('confirm-delete').addEventListener('click', confirmDelete);
}

function openDeleteModal(audio) {
  state.pendingDelete = audio;
  document.getElementById('confirm-name').textContent = audio.name;
  document.getElementById('confirm-modal').hidden = false;
}

function closeDeleteModal() {
  document.getElementById('confirm-modal').hidden = true;
  state.pendingDelete = null;
}

async function confirmDelete() {
  const audio = state.pendingDelete;
  if (!audio) return;
  const btn = document.getElementById('confirm-delete');
  btn.disabled = true;
  try {
    audioPlayer.stop(audio.id);
    audioPlayer.invalidateCache(audio.id);
    if (audio.storagePath) {
      try {
        await storage.ref(audio.storagePath).delete();
      } catch (err) {
        console.warn('Storage delete failed (continuing):', err);
      }
    }
    await deleteAudioNode(audio.id);
    showToast('Audio eliminado', 'success');
    closeDeleteModal();
  } catch (err) {
    showToast('No se pudo eliminar el audio', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ---- Audio activation gate ---- */

function setupAudioGate() {
  const gate = document.getElementById('audio-gate');
  if (!gate) return;
  // Clicking anywhere on the overlay is a genuine user gesture, enough to
  // unlock the AudioContext for the rest of the session.
  gate.addEventListener('click', async () => {
    await audioPlayer.unlock();
    if (audioPlayer.isUnlocked()) {
      hideAudioGate();
      showToast('Sonido activado', 'success');
    } else {
      showToast('No se pudo activar el sonido. Intentá de nuevo.', 'error');
    }
  });
}

function showAudioGate() {
  const gate = document.getElementById('audio-gate');
  if (gate) gate.hidden = false;
}

function hideAudioGate() {
  const gate = document.getElementById('audio-gate');
  if (gate) gate.hidden = true;
}

init();
