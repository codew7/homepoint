/* =========================================================================
   Nexo CRM · núcleo
   Utilidades, motor de movimiento (resortes), store reactivo y persistencia.
   Sin dependencias. Scripts clásicos para funcionar también con file://
   ========================================================================= */
window.CRM = window.CRM || {};

(function (NS) {
  'use strict';

  /* ---------------------------------------------------------------- util */
  const LOCALE = 'es-AR';

  const util = NS.util = {
    uid(prefix) {
      return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    clamp(v, a, b) { return Math.min(b, Math.max(a, v)); },
    lerp(a, b, t) { return a + (b - a) * t; },

    /* --- fechas --- */
    d(v) { return v instanceof Date ? v : new Date(v); },
    isSameDay(a, b) {
      a = util.d(a); b = util.d(b);
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    },
    startOfDay(v) { const x = util.d(v); x.setHours(0, 0, 0, 0); return x; },
    fmtTime(v) {
      return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }).format(util.d(v));
    },
    fmtDate(v) {
      return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }).format(util.d(v));
    },
    fmtDateShort(v) {
      return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short' }).format(util.d(v));
    },
    fmtDayLabel(v) {
      const now = new Date(), date = util.d(v);
      if (util.isSameDay(date, now)) return 'Hoy';
      const y = new Date(now); y.setDate(y.getDate() - 1);
      if (util.isSameDay(date, y)) return 'Ayer';
      const diff = (util.startOfDay(now) - util.startOfDay(date)) / 86400000;
      if (diff < 7) return new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(date).replace(/^./, c => c.toUpperCase());
      return util.fmtDate(date);
    },
    /* etiqueta compacta para listas: hora si es hoy, día si es esta semana */
    fmtStamp(v) {
      const now = new Date(), date = util.d(v);
      if (util.isSameDay(date, now)) return util.fmtTime(date);
      const diff = (util.startOfDay(now) - util.startOfDay(date)) / 86400000;
      if (diff === 1) return 'Ayer';
      if (diff < 7) return new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(date).replace('.', '');
      return util.fmtDateShort(date);
    },
    relTime(v) {
      const diff = Date.now() - util.d(v).getTime();
      const s = Math.round(diff / 1000);
      if (Math.abs(s) < 60) return 'recién';
      const m = Math.round(s / 60);
      if (Math.abs(m) < 60) return m + ' min';
      const h = Math.round(m / 60);
      if (Math.abs(h) < 24) return h + ' h';
      const dd = Math.round(h / 24);
      if (Math.abs(dd) < 30) return dd + ' d';
      return util.fmtDateShort(v);
    },
    /* duración legible a partir de minutos */
    dur(mins) {
      if (mins == null || isNaN(mins)) return '—';
      if (mins < 1) return Math.round(mins * 60) + ' s';
      if (mins < 60) return Math.round(mins) + ' min';
      const h = Math.floor(mins / 60), m = Math.round(mins % 60);
      return h + ' h' + (m ? ' ' + m + ' min' : '');
    },

    /* --- números --- */
    money(n, currency) {
      return new Intl.NumberFormat(LOCALE, {
        style: 'currency', currency: currency || 'ARS', maximumFractionDigits: 0
      }).format(Number(n) || 0);
    },
    moneyCompact(n, currency) {
      return new Intl.NumberFormat(LOCALE, {
        style: 'currency', currency: currency || 'ARS', notation: 'compact', maximumFractionDigits: 1
      }).format(Number(n) || 0);
    },
    num(n, dec) {
      return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: dec == null ? 0 : dec }).format(Number(n) || 0);
    },
    pct(n, dec) { return util.num((Number(n) || 0) * 100, dec == null ? 0 : dec) + '%'; },

    /* --- texto --- */
    initials(name) {
      const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    },
    hash(str) {
      let h = 0; str = String(str || '');
      for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
      return Math.abs(h);
    },
    avatarHue(seed) { return util.hash(seed) % 360; },
    phone(p) {
      const raw = String(p || '').replace(/\D/g, '');
      if (raw.length === 13 && raw.slice(0, 3) === '549')
        return '+' + raw.slice(0, 2) + ' ' + raw.slice(2, 3) + ' ' + raw.slice(3, 5) + ' ' + raw.slice(5, 9) + '-' + raw.slice(9);
      if (raw.length === 12 && raw.slice(0, 2) === '54')
        return '+' + raw.slice(0, 2) + ' ' + raw.slice(2, 4) + ' ' + raw.slice(4, 8) + '-' + raw.slice(8);
      return p ? '+' + raw : '';
    },
    phoneRaw(p) { return String(p || '').replace(/\D/g, ''); },
    truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; },
    slug(s) {
      return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    },
    /* búsqueda tolerante a acentos y mayúsculas */
    norm(s) {
      return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    },
    /* interpolación de variables {{1}} o {{nombre}} en plantillas */
    interpolate(body, vars) {
      return String(body || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (m, k) {
        const v = vars && (vars[k] != null ? vars[k] : vars[Number(k)]);
        return v == null ? m : String(v);
      });
    },
    /* formato liviano de WhatsApp: *negrita* _cursiva_ ~tachado~ ```mono``` */
    waFormat(text) {
      let s = util.esc(text);
      s = s.replace(/```([^`]+)```/g, '<code>$1</code>');
      s = s.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<strong>$2</strong>');
      s = s.replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>');
      s = s.replace(/(^|\s)~([^~\n]+)~/g, '$1<s>$2</s>');
      s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      return s.replace(/\n/g, '<br>');
    },

    debounce(fn, ms) {
      let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
    },
    throttle(fn, ms) {
      let last = 0, t;
      return function () {
        const a = arguments, c = this, now = Date.now();
        if (now - last >= ms) { last = now; fn.apply(c, a); }
        else { clearTimeout(t); t = setTimeout(function () { last = Date.now(); fn.apply(c, a); }, ms - (now - last)); }
      };
    },
    groupBy(arr, key) {
      const fn = typeof key === 'function' ? key : function (o) { return o[key]; };
      return arr.reduce(function (acc, item) { const k = fn(item); (acc[k] = acc[k] || []).push(item); return acc; }, {});
    },
    sum(arr, fn) { return arr.reduce(function (a, b) { return a + (fn ? fn(b) : b); }, 0); },
    avg(arr, fn) { return arr.length ? util.sum(arr, fn) / arr.length : 0; },
    median(arr) {
      if (!arr.length) return 0;
      const s = arr.slice().sort(function (a, b) { return a - b; }), m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    },
    /* percentil por interpolación lineal (p entre 0 y 1) */
    percentile(arr, p) {
      if (!arr.length) return 0;
      const s = arr.slice().sort(function (a, b) { return a - b; });
      const idx = util.clamp(p, 0, 1) * (s.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return lo === hi ? s[lo] : util.lerp(s[lo], s[hi], idx - lo);
    },

    /* --- archivos --- */
    download(filename, content, mime) {
      const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    },
    toCSV(rows, headers) {
      const cols = headers || Object.keys(rows[0] || {});
      const cell = function (v) {
        const s = v == null ? '' : String(v);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      return '﻿' + [cols.join(';')].concat(rows.map(function (r) {
        return cols.map(function (c) { return cell(r[c]); }).join(';');
      })).join('\r\n');
    },
    parseCSV(text) {
      const clean = String(text).replace(/^﻿/, '');
      const first = clean.split('\n')[0] || '';
      const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
      const rows = []; let row = [], field = '', q = false;
      for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (q) {
          if (c === '"') { if (clean[i + 1] === '"') { field += '"'; i++; } else q = false; }
          else field += c;
        } else if (c === '"') q = true;
        else if (c === delim) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
      }
      if (field || row.length) { row.push(field); rows.push(row); }
      if (!rows.length) return [];
      const head = rows.shift().map(function (h) { return h.trim(); });
      return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); })
        .map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = (r[i] || '').trim(); }); return o; });
    },
    copy(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      ta.remove();
      return Promise.resolve();
    }
  };

  /* ----------------------------------------------------------------- dom */
  const dom = NS.dom = {
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
      if (children != null) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
      return node;
    },
    frag(html) {
      const t = document.createElement('template');
      t.innerHTML = String(html).trim();
      return t.content;
    },
    /* delegación: dom.on(root, 'click', '[data-act]', handler) */
    on(root, type, sel, handler, opts) {
      root.addEventListener(type, function (e) {
        const target = e.target && e.target.closest ? e.target.closest(sel) : null;
        if (target && root.contains(target)) handler.call(target, e, target);
      }, opts);
    },
    icon(name, size) {
      return '<svg class="ic" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" ' +
        'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true">' + (NS.icons[name] || '') + '</svg>';
    }
  };

  /* -------------------------------------------------------------- motion */
  /* Resortes interrumpibles: la animación arranca siempre del valor en
     pantalla y hereda la velocidad del gesto. damping 1.0 = sin rebote;
     ~0.8 = rebote sólo cuando el gesto traía inercia.                      */
  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  const motion = NS.motion = {
    reduced: reduced,
    spring(opts) {
      const o = Object.assign({ from: 0, to: 1, velocity: 0, response: 0.4, damping: 1.0 }, opts);
      let x = o.from, v = o.velocity, target = o.to, raf = 0, last = 0, stopped = false;
      const omega = 2 * Math.PI / o.response;
      const k = omega * omega, c = 2 * o.damping * omega;

      function frame(t) {
        if (stopped) return;
        if (!last) last = t;
        const dt = Math.min((t - last) / 1000, 1 / 30); last = t;
        const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          const a = -k * (x - target) - c * v;
          v += a * h; x += v * h;
        }
        o.onUpdate && o.onUpdate(x, v);
        if (Math.abs(x - target) < (o.epsilon || 0.35) && Math.abs(v) < (o.epsilon || 0.35)) {
          x = target; o.onUpdate && o.onUpdate(x, 0);
          stopped = true; o.onComplete && o.onComplete(); return;
        }
        raf = requestAnimationFrame(frame);
      }
      if (reduced()) {
        x = target;
        setTimeout(function () { o.onUpdate && o.onUpdate(x, 0); o.onComplete && o.onComplete(); }, 0);
        return { stop() { }, retarget() { }, get value() { return x; }, get velocity() { return 0; } };
      }
      raf = requestAnimationFrame(frame);
      return {
        /* re-apuntar conservando posición y velocidad: sin "muro" al revertir */
        retarget(to) { target = to; if (stopped) { stopped = false; last = 0; raf = requestAnimationFrame(frame); } },
        stop() { stopped = true; cancelAnimationFrame(raf); },
        get value() { return x; },
        get velocity() { return v; }
      };
    },
    /* punto de reposo proyectado por la inercia (deceleración exponencial) */
    project(velocity, decelerationRate) {
      const d = decelerationRate == null ? 0.998 : decelerationRate;
      return (velocity / 1000) * d / (1 - d);
    },
    /* resistencia progresiva al pasar un límite */
    rubberband(overshoot, dimension, constant) {
      const c = constant == null ? 0.55 : constant;
      return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
    },
    /* historial corto de posiciones para calcular velocidad al soltar */
    tracker() {
      const hist = [];
      return {
        push(pos) {
          hist.push({ pos: pos, t: performance.now() });
          while (hist.length > 6) hist.shift();
        },
        velocity() {
          if (hist.length < 2) return 0;
          const a = hist[0], b = hist[hist.length - 1];
          const dt = (b.t - a.t) / 1000;
          return dt > 0.001 ? (b.pos - a.pos) / dt : 0;
        },
        reset() { hist.length = 0; }
      };
    }
  };

  /* --------------------------------------------------------------- store */
  const KEY = 'nexo.crm.v1';

  const store = NS.store = {
    state: null,
    _subs: {},

    on(evt, fn) {
      (this._subs[evt] = this._subs[evt] || []).push(fn);
      const self = this;
      return function () { self.off(evt, fn); };
    },
    off(evt, fn) {
      const list = this._subs[evt]; if (!list) return;
      const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1);
    },
    emit(evt, payload) {
      (this._subs[evt] || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error('[' + evt + ']', e); }
      });
      if (evt !== '*') this.emit('*', { type: evt, payload: payload });
    },

    load() {
      let data = null;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) data = JSON.parse(raw);
      } catch (e) { console.warn('Estado corrupto, se regenera.', e); }
      if (!data || !data.meta) data = NS.seed.build();
      this.state = NS.seed.migrate(data);
      return this.state;
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); }
      catch (e) {
        console.warn('No se pudo guardar localmente', e);
        NS.ui && NS.ui.toast('Sin espacio para guardar. Exportá y depurá datos.', 'danger');
      }
    },
    /* muta el estado, persiste (con retardo) y notifica */
    commit(mutator, evt, payload) {
      if (typeof mutator === 'function') mutator(this.state);
      this.state.meta.updatedAt = Date.now();
      this.persist();
      if (evt) this.emit(evt, payload);
      this.emit('change', { evt: evt, payload: payload });
    },
    persist: null,
    reset() { localStorage.removeItem(KEY); location.reload(); },
    export() { return JSON.stringify(this.state, null, 2); },
    import(json) {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data || !data.meta) throw new Error('Archivo no reconocido');
      this.state = NS.seed.migrate(data);
      this.save();
      return this.state;
    },

    /* -------- selectores -------- */
    contact(id) { return this.state.contacts.find(function (c) { return c.id === id; }); },
    conversation(id) { return this.state.conversations.find(function (c) { return c.id === id; }); },
    convOf(contactId) { return this.state.conversations.find(function (c) { return c.contactId === contactId; }); },
    agent(id) { return this.state.agents.find(function (a) { return a.id === id; }); },
    me() { return this.agent(this.state.session.agentId) || this.state.agents[0]; },
    tag(id) { return this.state.tags.find(function (t) { return t.id === id; }); },
    stage(id) { return this.state.stages.find(function (s) { return s.id === id; }); },
    template(id) { return this.state.templates.find(function (t) { return t.id === id; }); },
    dealsOf(contactId) { return this.state.deals.filter(function (d) { return d.contactId === contactId; }); },
    tasksOf(contactId) { return this.state.tasks.filter(function (t) { return t.contactId === contactId; }); },
    lastMessage(conv) { return conv.messages.length ? conv.messages[conv.messages.length - 1] : null; },

    log(type, text, refs) {
      this.state.activity.unshift({
        id: util.uid('act'), at: Date.now(), type: type, text: text,
        actor: (this.me() || {}).id, refs: refs || {}
      });
      if (this.state.activity.length > 600) this.state.activity.length = 600;
    }
  };
  store.persist = util.debounce(function () {
    store.save();
    store.emit('persisted');
  }, 350);

  /* --------------------------------------------------- iconos (grilla 24) */
  NS.icons = {
    inbox: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M5.5 5h13l1.5 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4z"/>',
    users: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="8" r="3.2"/><path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4"/><path d="M15.2 5.2a3.2 3.2 0 0 1 0 5.6"/>',
    funnel: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
    megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l7 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M20 7a7 7 0 0 1 0 10"/>',
    bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    send: '<path d="M4.5 12 20 4.5 14.5 20l-3-6z"/><path d="m11.5 14 8.5-9.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    checks: '<path d="m2 13 4 4 8-9"/><path d="m11 17 8-9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tag: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z"/><circle cx="8" cy="8" r="1.4"/>',
    note: '<path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5"/><path d="M8.5 13h7M8.5 16.5h4"/>',
    paperclip: '<path d="M20 11.5 12 19.5a4.5 4.5 0 0 1-6.4-6.4l8.2-8.2a3 3 0 0 1 4.3 4.3l-8.2 8.2a1.5 1.5 0 0 1-2.1-2.1L15.5 8"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
    template: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M9 9v11"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    chevronDown: '<path d="m5 9 7 7 7-7"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
    filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
    star: '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z"/>',
    pin: '<path d="M9 4h6l-1 5 3 3v2h-5v5l-1 1-1-1v-5H5v-2l3-3z"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 12.5a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9L17.5 7"/>',
    edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 5.5 18.5 9.5"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    logout: '<path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/><path d="M16 8l4 4-4 4"/><path d="M20 12H9"/>',
    phone: '<path d="M6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.7 2 2 0 0 1 6 3.5z"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8.5 19z"/><path d="M9.2 9.1c.2 1.6 2.2 3.7 3.8 4l.9-1.1 1.7.8v1.3c0 .6-.5 1-1.1.9a7 7 0 0 1-6.2-6.2c-.1-.6.3-1.1.9-1.1h1.3z"/>',
    link: '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2"/>',
    sparkle: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 20V9"/><path d="m7.5 13 4.5-4.5 4.5 4.5"/><path d="M5 4h14"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
    archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5.5 8.5v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-10"/><path d="M10 12.5h4"/>',
    play: '<path d="M7 5.5 18.5 12 7 18.5z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    building: '<path d="M4 20V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14"/><path d="M14 10h4a2 2 0 0 1 2 2v8"/><path d="M7.5 8h3M7.5 12h3M7.5 16h3M17 14h.01M17 17.5h.01"/><path d="M3 20h18"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    warn: '<path d="M12 4.5 21 19H3z"/><path d="M12 10v4M12 16.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    command: '<path d="M8.5 6.5a2 2 0 1 0-2 2h11a2 2 0 1 0-2-2v11a2 2 0 1 0 2-2h-11a2 2 0 1 0 2 2z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-13.7-5.2L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 13.7 5.2L20 16"/><path d="M20 20v-4h-4"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.5 7.1"/>',
    shield: '<path d="M12 3.5 20 6v6c0 4.5-3.2 7.6-8 9.5-4.8-1.9-8-5-8-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    kanban: '<rect x="3.5" y="4" width="5" height="12" rx="1.5"/><rect x="10" y="4" width="5" height="16" rx="1.5"/><rect x="16.5" y="4" width="4" height="8" rx="1.5"/>',
    dollar: '<path d="M12 3v18"/><path d="M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3"/>',
    mic: '<rect x="9.5" y="3.5" width="5" height="10" rx="2.5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.5-4 3.5 3 3-2.5 4.5 4"/>',
    file: '<path d="M6 3.5h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z"/><path d="M13 3.5v5h5"/>',
    snooze: '<circle cx="12" cy="12.5" r="8"/><path d="M9.5 10h5l-5 5h5"/><path d="M4 4.5 7 2.5M20 4.5 17 2.5"/>',
    handoff: '<path d="M4 8h11"/><path d="m11 4 4 4-4 4"/><path d="M20 16H9"/><path d="m13 20-4-4 4-4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    inboxOpen: '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M3 12 6 4h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
  };

})(window.CRM);
