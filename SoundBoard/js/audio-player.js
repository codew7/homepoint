// Web Audio API based player with in-memory blob cache and sequential queue.
class AudioPlayer {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bufferCache = new Map(); // audioId -> AudioBuffer
    this.fetchPromises = new Map();
    this.currentSource = null;
    this.currentGain = null;
    this.currentAudioId = null;
    this.queue = [];
    this.listeners = new Set();
    this.masterVolume = this._loadMasterVolume();
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    // NOTE: resume() is intentionally NOT called here. The browser autoplay
    // policy only lets it succeed inside a user gesture; calling it elsewhere
    // just spams a console warning. Resume happens in unlock() (gesture) and,
    // as a recovery attempt, in _playNow().
  }

  isUnlocked() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // Call this from a real user gesture (click/keydown) to unlock the actual
  // playback context. Without this, scheduled (cyclic/fixed) plays that happen
  // without a recent gesture fail with the autoplay-policy error.
  async unlock() {
    this._ensureContext();
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (e) { /* ignore */ }
    }
  }

  _loadMasterVolume() {
    const stored = localStorage.getItem('sb_master_volume');
    if (stored !== null) {
      const v = parseFloat(stored);
      if (!isNaN(v)) return Math.min(1, Math.max(0, v));
    }
    return 0.8;
  }

  setMasterVolume(value) {
    this.masterVolume = Math.min(1, Math.max(0, value));
    localStorage.setItem('sb_master_volume', String(this.masterVolume));
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
  }

  getMasterVolume() {
    return this.masterVolume;
  }

  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _emit(event) {
    this.listeners.forEach(cb => {
      try { cb(event); } catch (e) { console.error(e); }
    });
  }

  isPlaying(audioId) {
    return this.currentAudioId === audioId;
  }

  getCurrentId() {
    return this.currentAudioId;
  }

  async _loadBuffer(audio) {
    if (this.bufferCache.has(audio.id)) {
      return this.bufferCache.get(audio.id);
    }
    if (this.fetchPromises.has(audio.id)) {
      return this.fetchPromises.get(audio.id);
    }
    this._ensureContext();
    const promise = fetch(audio.storageUrl)
      .then(r => {
        if (!r.ok) throw new Error('No se pudo descargar el audio');
        return r.arrayBuffer();
      })
      .then(buf => this.ctx.decodeAudioData(buf))
      .then(decoded => {
        this.bufferCache.set(audio.id, decoded);
        this.fetchPromises.delete(audio.id);
        return decoded;
      })
      .catch(err => {
        this.fetchPromises.delete(audio.id);
        throw err;
      });
    this.fetchPromises.set(audio.id, promise);
    return promise;
  }

  invalidateCache(audioId) {
    this.bufferCache.delete(audioId);
    this.fetchPromises.delete(audioId);
  }

  async play(audio, { trigger = 'manual', onPlayed } = {}) {
    this._ensureContext();
    // If already playing something, queue this one
    if (this.currentSource) {
      this.queue.push({ audio, trigger, onPlayed });
      this._emit({ type: 'queued', audioId: audio.id });
      return;
    }
    return this._playNow(audio, trigger, onPlayed);
  }

  async _playNow(audio, trigger, onPlayed) {
    try {
      const buffer = await this._loadBuffer(audio);
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch (e) { /* ignore */ }
      }
      if (this.ctx.state !== 'running') {
        // No user gesture yet (autoplay policy). Don't start a silent source —
        // signal the UI so it can prompt the operator to activate sound.
        this.currentSource = null;
        this.currentGain = null;
        this.currentAudioId = null;
        this._emit({ type: 'locked', audioId: audio.id });
        this.queue = []; // avoid replaying stale, time-sensitive announcements
        return;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      const gain = this.ctx.createGain();
      gain.gain.value = typeof audio.volume === 'number' ? audio.volume : 0.8;
      source.connect(gain);
      gain.connect(this.masterGain);

      this.currentSource = source;
      this.currentGain = gain;
      this.currentAudioId = audio.id;

      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
          this.currentGain = null;
          this.currentAudioId = null;
          this._emit({ type: 'ended', audioId: audio.id });
          this._drainQueue();
        }
      };
      source.start(0);
      this._emit({ type: 'started', audioId: audio.id, trigger });
      if (onPlayed) {
        try { onPlayed(); } catch (e) { console.warn(e); }
      }
    } catch (err) {
      console.error('Reproduccion fallida', err);
      this.currentSource = null;
      this.currentGain = null;
      this.currentAudioId = null;
      this._emit({ type: 'error', audioId: audio.id, error: err.message });
      this._drainQueue();
    }
  }

  _drainQueue() {
    if (this.queue.length === 0) return;
    const next = this.queue.shift();
    this._playNow(next.audio, next.trigger, next.onPlayed);
  }

  stop(audioId) {
    if (audioId && this.currentAudioId !== audioId) {
      // Remove from queue if present
      this.queue = this.queue.filter(q => q.audio.id !== audioId);
      this._emit({ type: 'queue-changed' });
      return;
    }
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch (e) { /* noop */ }
    }
  }

  stopAll() {
    this.queue = [];
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch (e) { /* noop */ }
    }
  }

  setVolumeFor(audioId, value) {
    if (this.currentAudioId === audioId && this.currentGain) {
      this.currentGain.gain.value = Math.min(1, Math.max(0, value));
    }
  }
}

export const audioPlayer = new AudioPlayer();
