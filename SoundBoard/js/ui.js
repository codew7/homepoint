import { audioPlayer } from './audio-player.js';
import { scheduler } from './scheduler.js';
import { updateAudio } from './realtime-db.js';

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatNextRun(ts) {
  if (!ts) return null;
  const now = Date.now();
  const diff = ts - now;
  if (diff < 0) return 'ahora';
  const totalSec = Math.floor(diff / 1000);
  if (totalSec < 60) return `en ${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `en ${min}m ${totalSec % 60}s`;
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  const d = new Date(ts);
  return d.toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function summarizeSchedules(schedules) {
  if (!schedules || schedules.length === 0) return 'Sin programación';
  const parts = [];
  const fixed = schedules.find(s => s.type === 'fixed');
  if (fixed && fixed.times && fixed.times.length > 0) {
    parts.push(`${fixed.times.length} horario${fixed.times.length > 1 ? 's' : ''}`);
  }
  const cyclic = schedules.find(s => s.type === 'cyclic');
  if (cyclic && cyclic.intervalMinutes > 0) {
    parts.push(`cada ${cyclic.intervalMinutes}m`);
  }
  return parts.length ? parts.join(' · ') : 'Sin programación';
}

export function renderAudioGrid(audios, filter, callbacks) {
  const grid = document.getElementById('audio-grid');
  const empty = document.getElementById('empty-state');
  if (!grid) return;

  let filtered = audios;
  if (filter === 'active') filtered = audios.filter(a => a.isActive);
  else if (filter === 'inactive') filtered = audios.filter(a => !a.isActive);

  if (audios.length === 0) {
    grid.innerHTML = '';
    grid.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  grid.hidden = false;

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No hay audios en esta vista.</div>';
    return;
  }

  // Build new card map
  const existing = new Map();
  grid.querySelectorAll('.audio-card').forEach(el => existing.set(el.dataset.id, el));

  const wanted = new Set();
  filtered.forEach(audio => {
    wanted.add(audio.id);
    let card = existing.get(audio.id);
    if (!card) {
      card = buildCard(audio, callbacks);
      grid.appendChild(card);
    } else {
      updateCard(card, audio);
    }
  });

  // Remove cards no longer in the list
  existing.forEach((el, id) => {
    if (!wanted.has(id)) el.remove();
  });

  // Remove skeletons
  grid.querySelectorAll('.skeleton-card').forEach(s => s.remove());
}

function buildCard(audio, callbacks) {
  const card = document.createElement('article');
  card.className = 'audio-card';
  card.dataset.id = audio.id;
  card.style.setProperty('--audio-color', audio.color || '#6366F1');

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">
        <h3 class="card-name"></h3>
        <span class="card-desc"></span>
      </div>
      <span class="card-status"></span>
    </div>
    <div class="card-row card-row-schedule">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span class="schedule-summary"></span>
    </div>
    <div class="card-row next-play">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      <span class="next-play-text">—</span>
    </div>
    <div class="card-row card-volume">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      </svg>
      <input type="range" class="slider vol-slider" min="0" max="100" />
      <span class="vol-value"></span>
    </div>
    <div class="card-actions">
      <div class="card-actions-left">
        <button class="play-btn" title="Reproducir/Detener">
          <svg class="icon-play" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <svg class="icon-stop" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" hidden><rect x="5" y="5" width="14" height="14" rx="1"/></svg>
        </button>
        <button class="icon-btn schedule-btn" title="Programar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </button>
        <button class="icon-btn delete-btn danger" title="Eliminar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>
      <div class="card-actions-right">
        <span class="duration"></span>
        <label class="switch">
          <input type="checkbox" class="active-toggle" />
          <span class="switch-slider"></span>
        </label>
      </div>
    </div>
  `;

  // Bind events
  const playBtn = card.querySelector('.play-btn');
  playBtn.addEventListener('click', () => {
    if (audioPlayer.isPlaying(audio.id)) {
      audioPlayer.stop(audio.id);
    } else {
      callbacks.onPlay && callbacks.onPlay(audio);
    }
  });

  const volSlider = card.querySelector('.vol-slider');
  volSlider.addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    card.querySelector('.vol-value').textContent = `${e.target.value}%`;
    audioPlayer.setVolumeFor(audio.id, v);
  });
  volSlider.addEventListener('change', (e) => {
    const v = Number(e.target.value) / 100;
    updateAudio(audio.id, { volume: v }).catch(() => showToast('No se pudo guardar el volumen', 'error'));
  });

  card.querySelector('.schedule-btn').addEventListener('click', () => {
    callbacks.onSchedule && callbacks.onSchedule(audio);
  });
  card.querySelector('.delete-btn').addEventListener('click', () => {
    callbacks.onDelete && callbacks.onDelete(audio);
  });
  card.querySelector('.active-toggle').addEventListener('change', (e) => {
    updateAudio(audio.id, { isActive: e.target.checked })
      .catch(() => showToast('No se pudo actualizar el estado', 'error'));
  });

  updateCard(card, audio);
  return card;
}

function updateCard(card, audio) {
  card.style.setProperty('--audio-color', audio.color || '#6366F1');
  card.classList.toggle('inactive', !audio.isActive);

  card.querySelector('.card-name').textContent = audio.name || 'Sin nombre';
  const descEl = card.querySelector('.card-desc');
  descEl.textContent = audio.description || '';
  descEl.style.display = audio.description ? '' : 'none';

  card.querySelector('.schedule-summary').textContent = summarizeSchedules(audio.schedules);

  const dur = card.querySelector('.duration');
  dur.textContent = formatDuration(audio.duration);

  const toggle = card.querySelector('.active-toggle');
  if (toggle.checked !== !!audio.isActive) toggle.checked = !!audio.isActive;

  const volSlider = card.querySelector('.vol-slider');
  const volValue = Math.round((audio.volume ?? 0.8) * 100);
  if (Number(volSlider.value) !== volValue) {
    volSlider.value = volValue;
    card.querySelector('.vol-value').textContent = `${volValue}%`;
  }

  refreshCardState(card, audio);
}

export function refreshCardState(card, audio) {
  const playing = audioPlayer.isPlaying(audio.id);
  card.classList.toggle('playing', playing);

  const statusEl = card.querySelector('.card-status');
  statusEl.className = 'card-status';
  if (playing) {
    statusEl.classList.add('playing');
    statusEl.innerHTML = '<span class="playing-indicator"><span></span><span></span><span></span><span></span></span> Reproduciendo';
  } else if (audio.isActive) {
    statusEl.classList.add('active');
    statusEl.textContent = 'Activo';
  } else {
    statusEl.textContent = 'Inactivo';
  }

  const playBtn = card.querySelector('.play-btn');
  playBtn.querySelector('.icon-play').hidden = playing;
  playBtn.querySelector('.icon-stop').hidden = !playing;

  // Next run
  const nextRunEl = card.querySelector('.next-play-text');
  if (playing) {
    nextRunEl.innerHTML = '<strong>en curso</strong>';
  } else {
    const next = scheduler.getNextRun(audio.id);
    nextRunEl.innerHTML = next ? `próx. <strong>${formatNextRun(next)}</strong>` : '<span style="opacity:0.7">sin programación activa</span>';
  }
}

export function refreshAllCardStates(audios) {
  const grid = document.getElementById('audio-grid');
  if (!grid) return;
  const map = new Map(audios.map(a => [a.id, a]));
  grid.querySelectorAll('.audio-card').forEach(card => {
    const audio = map.get(card.dataset.id);
    if (audio) refreshCardState(card, audio);
  });
}

export function renderStats(audios) {
  const total = audios.length;
  const active = audios.filter(a => a.isActive).length;
  const playingId = audioPlayer.getCurrentId();
  const playing = playingId ? 1 : 0;
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setText('stat-total', total);
  setText('stat-active', active);
  setText('stat-playing', playing);
  const sa = document.getElementById('status-active-count');
  if (sa) sa.textContent = `${active} activo${active !== 1 ? 's' : ''}`;
}

export function renderPlayLog(entries) {
  const ul = document.getElementById('play-log-list');
  if (!ul) return;
  if (!entries || entries.length === 0) {
    ul.innerHTML = '<li class="log-empty">Sin reproducciones registradas todavía.</li>';
    const last = document.getElementById('stat-last');
    if (last) last.textContent = '—';
    return;
  }
  ul.innerHTML = '';
  entries.forEach(e => {
    const li = document.createElement('li');
    const time = new Date(e.playedAt);
    const timeText = time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateText = time.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    li.innerHTML = `
      <span class="log-name">
        <span class="log-color" style="background:${e.color || '#6366F1'}"></span>
        <span>${escapeHtml(e.audioName || 'Audio')}</span>
        <span class="muted">· ${e.triggeredBy === 'schedule' ? 'horario' : e.triggeredBy === 'cyclic' ? 'cíclico' : 'manual'}</span>
      </span>
      <span class="log-time">${dateText} ${timeText}</span>
    `;
    ul.appendChild(li);
  });
  const last = document.getElementById('stat-last');
  if (last && entries[0]) {
    const d = new Date(entries[0].playedAt);
    last.textContent = `${entries[0].audioName} · ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}
