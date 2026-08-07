import { audioPlayer } from './audio-player.js';
import { logPlay } from './play-log.js';

class Scheduler {
  constructor() {
    this.audios = new Map(); // id -> audio
    this.cyclicNextRun = new Map(); // id -> timestamp
    this.lastFixedFire = new Map(); // id -> "YYYY-MM-DD HH:MM" string
    this.tickInterval = null;
    this.nextRunListeners = new Set();
  }

  start() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this._tick(), 1000);
    this._tick();
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  syncAudios(list) {
    const newIds = new Set(list.map(a => a.id));
    // Cleanup removed
    for (const id of this.audios.keys()) {
      if (!newIds.has(id)) {
        this.audios.delete(id);
        this.cyclicNextRun.delete(id);
        this.lastFixedFire.delete(id);
      }
    }
    list.forEach(a => {
      const prev = this.audios.get(a.id);
      this.audios.set(a.id, a);
      // Reset cyclic when schedule changes or first time
      if (!prev || this._schedulesChanged(prev, a) || !this.cyclicNextRun.has(a.id)) {
        this._resetCyclic(a);
      }
    });
    this._notifyNextRun();
  }

  _schedulesChanged(prev, curr) {
    return JSON.stringify(prev.schedules || []) !== JSON.stringify(curr.schedules || []);
  }

  _resetCyclic(audio) {
    const cyclic = (audio.schedules || []).find(s => s.type === 'cyclic');
    if (cyclic && cyclic.intervalMinutes > 0 && audio.isActive) {
      this.cyclicNextRun.set(audio.id, Date.now() + cyclic.intervalMinutes * 60000);
    } else {
      this.cyclicNextRun.delete(audio.id);
    }
  }

  _tick() {
    const now = new Date();
    const nowMs = now.getTime();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const today = now.getDay();

    for (const audio of this.audios.values()) {
      if (!audio.isActive) continue;
      const schedules = audio.schedules || [];

      // Fixed schedules
      for (const sched of schedules) {
        if (sched.type !== 'fixed') continue;
        const daysOk = !sched.daysOfWeek || sched.daysOfWeek.length === 0 || sched.daysOfWeek.includes(today);
        if (!daysOk) continue;
        const currentTime = `${hh}:${mm}`;
        if (sched.times && sched.times.includes(currentTime)) {
          const fireKey = `${dateKey} ${currentTime}`;
          if (this.lastFixedFire.get(audio.id) !== fireKey) {
            this.lastFixedFire.set(audio.id, fireKey);
            this._trigger(audio, 'schedule');
          }
        }
      }

      // Cyclic
      const cyclic = schedules.find(s => s.type === 'cyclic');
      if (cyclic && cyclic.intervalMinutes > 0) {
        const nextRun = this.cyclicNextRun.get(audio.id);
        if (!nextRun) {
          this.cyclicNextRun.set(audio.id, nowMs + cyclic.intervalMinutes * 60000);
        } else if (nowMs >= nextRun) {
          this._trigger(audio, 'cyclic');
          this.cyclicNextRun.set(audio.id, nowMs + cyclic.intervalMinutes * 60000);
        }
      }
    }

    this._notifyNextRun();
  }

  _trigger(audio, trigger) {
    audioPlayer.play(audio, {
      trigger,
      onPlayed: () => logPlay(audio, trigger)
    });
  }

  getNextRun(audioId) {
    const audio = this.audios.get(audioId);
    if (!audio || !audio.isActive) return null;
    const schedules = audio.schedules || [];
    const candidates = [];
    const now = new Date();

    // Fixed
    for (const sched of schedules) {
      if (sched.type !== 'fixed' || !sched.times || sched.times.length === 0) continue;
      const days = sched.daysOfWeek && sched.daysOfWeek.length > 0 ? sched.daysOfWeek : [0,1,2,3,4,5,6];
      for (let offset = 0; offset < 8; offset++) {
        const d = new Date(now);
        d.setDate(d.getDate() + offset);
        if (!days.includes(d.getDay())) continue;
        for (const t of sched.times) {
          const [h, m] = t.split(':').map(Number);
          const candidate = new Date(d);
          candidate.setHours(h, m, 0, 0);
          if (candidate.getTime() > now.getTime()) {
            candidates.push(candidate.getTime());
          }
        }
      }
    }

    // Cyclic
    const nextCyclic = this.cyclicNextRun.get(audioId);
    if (nextCyclic) candidates.push(nextCyclic);

    if (candidates.length === 0) return null;
    return Math.min(...candidates);
  }

  onNextRunChange(cb) {
    this.nextRunListeners.add(cb);
    return () => this.nextRunListeners.delete(cb);
  }

  _notifyNextRun() {
    this.nextRunListeners.forEach(cb => {
      try { cb(); } catch (e) { console.error(e); }
    });
  }
}

export const scheduler = new Scheduler();
