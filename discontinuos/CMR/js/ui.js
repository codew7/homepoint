/* =========================================================================
   Nexo CRM · kit de interfaz
   Avisos, modales, cajones, menús anclados, confirmaciones, sonido y piezas
   reutilizables de marcado.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, el = dom.el, esc = util.esc, icon = dom.icon;

  const ui = NS.ui = {};

  /* ------------------------------------------------------------- avisos */
  let toastWrap = null;
  function ensureToastWrap() {
    if (!toastWrap) {
      toastWrap = el('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastWrap);
    }
    return toastWrap;
  }

  const TOAST_ICON = { ok: 'check', danger: 'warn', warn: 'warn', info: 'info' };

  ui.toast = function (message, kind, opts) {
    opts = opts || {};
    kind = kind || 'info';
    const node = el('div', { class: 'toast', dataset: { kind: kind } });
    node.innerHTML = icon(TOAST_ICON[kind] || 'info', 16) + '<span></span>';
    node.querySelector('span').textContent = message;
    if (opts.action) {
      const b = el('button', { class: 'btn btn-sm', text: opts.action.label });
      b.addEventListener('click', function () { opts.action.onClick(); dismiss(); });
      node.appendChild(b);
    }
    ensureToastWrap().appendChild(node);
    let timer = setTimeout(dismiss, opts.duration || (kind === 'danger' ? 6000 : 3600));
    node.addEventListener('pointerenter', function () { clearTimeout(timer); });
    node.addEventListener('pointerleave', function () { timer = setTimeout(dismiss, 1800); });

    function dismiss() {
      clearTimeout(timer);
      if (!node.parentNode) return;
      node.classList.add('out');
      setTimeout(function () { node.remove(); }, 220);
    }
    return dismiss;
  };

  /* ---------------------------------------------------- capa de bloqueo */
  const layers = [];

  function pushLayer(overlay, onClose) {
    layers.push({ overlay: overlay, onClose: onClose });
  }

  function closeTop() {
    const top = layers[layers.length - 1];
    if (top) top.onClose();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && layers.length) {
      e.stopPropagation();
      closeTop();
    }
  }, true);

  /* enfoque atrapado dentro de la capa superior */
  document.addEventListener('focusin', function (e) {
    const top = layers[layers.length - 1];
    if (!top || !top.overlay.isConnected) return;
    if (!top.overlay.contains(e.target)) {
      const first = top.overlay.querySelector('input, textarea, select, button, [tabindex]');
      if (first) first.focus();
    }
  });

  function buildOverlay(className) {
    const overlay = el('div', { class: 'overlay' + (className ? ' ' + className : '') });
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeOverlay(overlay, done) {
    if (!overlay.isConnected) return;
    overlay.classList.add('closing');
    const i = layers.findIndex(function (l) { return l.overlay === overlay; });
    if (i >= 0) layers.splice(i, 1);
    setTimeout(function () { overlay.remove(); done && done(); }, 210);
  }

  /* -------------------------------------------------------------- modal */
  /* opts: {title, subtitle, icon, body (HTMLElement|string), actions:[{label,
     variant, onClick(api), autofocus, keepOpen}], size, onClose, dismissible} */
  ui.modal = function (opts) {
    opts = opts || {};
    const overlay = buildOverlay();
    const modal = el('div', { class: 'modal' + (opts.size === 'wide' ? ' wide' : opts.size === 'narrow' ? ' narrow' : ''), role: 'dialog', 'aria-modal': 'true' });

    const api = {
      root: modal,
      overlay: overlay,
      close: function (result) {
        closeOverlay(overlay, function () { opts.onClose && opts.onClose(result); });
      },
      setBusy: function (on) {
        modal.querySelectorAll('.modal-foot .btn').forEach(function (b) { b.classList.toggle('is-disabled', !!on); });
      }
    };

    if (opts.title !== false) {
      const head = el('div', { class: 'modal-head' });
      head.innerHTML =
        (opts.icon ? '<span class="empty-mark" style="width:34px;height:34px;border-radius:10px">' + icon(opts.icon, 17) + '</span>' : '') +
        '<div class="stack" style="min-width:0;gap:1px">' +
        '<div class="t-md truncate">' + esc(opts.title || '') + '</div>' +
        (opts.subtitle ? '<div class="t-sm muted truncate">' + esc(opts.subtitle) + '</div>' : '') +
        '</div>';
      const close = el('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Cerrar', html: icon('x', 16) });
      close.addEventListener('click', function () { api.close(null); });
      head.appendChild(el('div', { class: 'spacer' }));
      head.appendChild(close);
      modal.appendChild(head);
    }

    const body = el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    modal.appendChild(body);
    api.body = body;

    if (opts.actions && opts.actions.length) {
      const foot = el('div', { class: 'modal-foot' });
      foot.appendChild(el('div', { class: 'spacer' }));
      opts.actions.forEach(function (a) {
        const b = el('button', {
          class: 'btn ' + (a.variant === 'primary' ? 'btn-primary' : a.variant === 'danger' ? 'btn-danger' : 'btn-outline'),
          text: a.label
        });
        b.addEventListener('click', function () {
          const r = a.onClick ? a.onClick(api) : true;
          if (r !== false && !a.keepOpen) api.close(r);
        });
        if (a.autofocus) setTimeout(function () { b.focus(); }, 60);
        foot.appendChild(b);
      });
      modal.appendChild(foot);
    }

    overlay.appendChild(modal);
    if (opts.dismissible !== false) {
      overlay.addEventListener('pointerdown', function (e) {
        if (e.target === overlay) api.close(null);
      });
    }
    pushLayer(overlay, function () { if (opts.dismissible !== false) api.close(null); });

    /* primer campo enfocado sin esperar a la animación completa */
    setTimeout(function () {
      const f = body.querySelector('[data-autofocus], input:not([type=hidden]), textarea, select');
      if (f) f.focus();
    }, 120);

    return api;
  };

  /* ------------------------------------------------------- confirmación */
  ui.confirm = function (opts) {
    if (typeof opts === 'string') opts = { message: opts };
    return new Promise(function (resolve) {
      let done = false;
      const finish = function (v) { if (!done) { done = true; resolve(v); } };
      ui.modal({
        size: 'narrow',
        title: opts.title || '¿Confirmás?',
        icon: opts.danger ? 'warn' : 'info',
        body: '<div class="t-base muted" style="line-height:1.6">' + esc(opts.message || '') + '</div>',
        actions: [
          { label: opts.cancelText || 'Cancelar', onClick: function () { finish(false); } },
          {
            label: opts.confirmText || 'Confirmar',
            variant: opts.danger ? 'danger' : 'primary',
            autofocus: true,
            onClick: function () { finish(true); }
          }
        ],
        onClose: function () { finish(false); }
      });
    });
  };

  /* --------------------------------------------------------- formulario */
  /* fields: [{key,label,type,value,placeholder,hint,options,required,rows,min,max}] */
  ui.form = function (opts) {
    return new Promise(function (resolve) {
      const wrap = el('div', { class: 'stack', style: { gap: '14px' } });
      const inputs = {};
      (opts.fields || []).forEach(function (f) {
        const field = el('div', { class: 'field' });
        if (f.label) field.appendChild(el('label', { class: 'label', text: f.label + (f.required ? ' *' : '') }));
        let input;
        if (f.type === 'textarea') {
          input = el('textarea', { class: 'textarea', rows: f.rows || 4, placeholder: f.placeholder || '' });
          input.value = f.value == null ? '' : f.value;
        } else if (f.type === 'select') {
          input = el('select', { class: 'select' });
          (f.options || []).forEach(function (o) {
            const opt = el('option', { value: o.value, text: o.label });
            if (String(o.value) === String(f.value)) opt.selected = true;
            input.appendChild(opt);
          });
        } else if (f.type === 'switch') {
          input = el('button', { class: 'switch', role: 'switch', 'aria-checked': f.value ? 'true' : 'false' });
          input.addEventListener('click', function () {
            input.setAttribute('aria-checked', input.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
          });
        } else {
          input = el('input', {
            class: 'input', type: f.type || 'text', placeholder: f.placeholder || '',
            min: f.min, max: f.max, step: f.step
          });
          input.value = f.value == null ? '' : f.value;
        }
        inputs[f.key] = { node: input, def: f };
        field.appendChild(input);
        if (f.hint) field.appendChild(el('div', { class: 'hint', text: f.hint }));
        wrap.appendChild(field);
      });

      let done = false;
      const finish = function (v) { if (!done) { done = true; resolve(v); } };

      ui.modal({
        title: opts.title, subtitle: opts.subtitle, icon: opts.icon, size: opts.size,
        body: wrap,
        actions: [
          { label: 'Cancelar', onClick: function () { finish(null); } },
          {
            label: opts.submitText || 'Guardar', variant: 'primary', keepOpen: true,
            onClick: function (api) {
              const out = {};
              let bad = null;
              Object.keys(inputs).forEach(function (k) {
                const it = inputs[k];
                const v = it.def.type === 'switch'
                  ? it.node.getAttribute('aria-checked') === 'true'
                  : (it.def.type === 'number' ? Number(it.node.value) : it.node.value.trim());
                if (it.def.required && (v === '' || v == null)) bad = bad || it.node;
                out[k] = v;
              });
              if (bad) {
                bad.focus();
                ui.toast('Completá los campos obligatorios', 'warn');
                return false;
              }
              finish(out);
              api.close();
            }
          }
        ],
        onClose: function () { finish(null); }
      });
    });
  };

  /* ------------------------------------------------------------- cajón */
  ui.drawer = function (opts) {
    const overlay = buildOverlay();
    overlay.style.padding = '0';
    overlay.style.placeItems = 'stretch';
    const panel = el('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true' });

    const api = {
      root: panel,
      close: function () { closeOverlay(overlay, opts.onClose); },
      setTitle: function (t) { const n = panel.querySelector('[data-drawer-title]'); if (n) n.textContent = t; }
    };

    const head = el('div', { class: 'modal-head' });
    head.innerHTML = '<div class="stack" style="min-width:0;gap:1px">' +
      '<div class="t-md truncate" data-drawer-title>' + esc(opts.title || '') + '</div>' +
      (opts.subtitle ? '<div class="t-sm muted truncate">' + esc(opts.subtitle) + '</div>' : '') + '</div>';
    const x = el('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Cerrar', html: icon('x', 16) });
    x.addEventListener('click', api.close);
    head.appendChild(el('div', { class: 'spacer' }));
    head.appendChild(x);
    panel.appendChild(head);

    const body = el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    panel.appendChild(body);
    api.body = body;

    if (opts.footer) {
      const foot = el('div', { class: 'modal-foot' });
      if (typeof opts.footer === 'string') foot.innerHTML = opts.footer; else foot.appendChild(opts.footer);
      panel.appendChild(foot);
    }

    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', function (e) { if (e.target === overlay) api.close(); });
    pushLayer(overlay, api.close);
    return api;
  };

  /* ------------------------------------------------------ menú anclado */
  /* Se abre desde su disparador: el origen de la transformación queda en el
     borde del botón para conservar la relación espacial.                  */
  let openMenu = null;

  ui.menu = function (anchor, items, opts) {
    opts = opts || {};
    ui.closeMenu();
    const menu = el('div', { class: 'menu', role: 'menu' });

    items.forEach(function (it) {
      if (!it) return;
      if (it.sep) { menu.appendChild(el('div', { class: 'menu-sep' })); return; }
      if (it.group) { menu.appendChild(el('div', { class: 'menu-label', text: it.group })); return; }
      const b = el('button', { class: 'menu-item', role: 'menuitem', dataset: it.variant ? { variant: it.variant } : {} });
      b.innerHTML = (it.icon ? icon(it.icon, 16) : '<span style="width:16px"></span>') +
        '<span class="truncate">' + esc(it.label) + '</span>' +
        (it.checked ? '<span class="spacer"></span>' + icon('check', 15) : '') +
        (it.hint ? '<span class="spacer"></span><span class="t-xs faint">' + esc(it.hint) + '</span>' : '');
      if (it.disabled) b.classList.add('is-disabled');
      b.addEventListener('click', function () {
        ui.closeMenu();
        it.onClick && it.onClick();
      });
      menu.appendChild(b);
    });

    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const align = opts.align || 'left';
    let left = align === 'right' ? r.right - mw : r.left;
    let top = r.bottom + 6;
    let originY = 'top';
    if (top + mh > innerHeight - 10) { top = Math.max(10, r.top - mh - 6); originY = 'bottom'; }
    left = util.clamp(left, 10, Math.max(10, innerWidth - mw - 10));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.setProperty('--origin', originY + ' ' + (align === 'right' ? 'right' : 'left'));

    const close = function () {
      if (!menu.isConnected) return;
      menu.remove();
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      openMenu = null;
    };
    const outside = function (e) { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
    setTimeout(function () {
      document.addEventListener('pointerdown', outside, true);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);
    }, 0);
    openMenu = { close: close };
    return openMenu;
  };

  ui.closeMenu = function () { if (openMenu) openMenu.close(); };

  /* ------------------------------------------------------ piezas de HTML */
  ui.avatarHTML = function (name, opts) {
    opts = opts || {};
    const hue = util.avatarHue(opts.seed || name);
    return '<div class="avatar ' + (opts.size ? 'avatar-' + opts.size : '') + '" style="--h:' + hue + '" ' +
      'title="' + esc(name) + '">' + esc(util.initials(name)) +
      (opts.status ? '<i class="avatar-dot" data-status="' + esc(opts.status) + '"></i>' : '') +
      '</div>';
  };

  ui.tagHTML = function (tag, removable) {
    if (!tag) return '';
    return '<span class="chip" data-color="' + esc(tag.color || 'neutral') + '" data-tag="' + esc(tag.id) + '">' +
      esc(tag.name) +
      (removable ? '<button class="chip-x" data-act="untag" data-id="' + esc(tag.id) + '" aria-label="Quitar">' + icon('x', 11) + '</button>' : '') +
      '</span>';
  };

  ui.empty = function (iconName, title, text, actionHTML) {
    return '<div class="empty">' +
      '<div class="empty-mark">' + icon(iconName, 24) + '</div>' +
      '<div class="stack" style="gap:4px;align-items:center">' +
      '<div class="t-md" style="color:var(--ink-1)">' + esc(title) + '</div>' +
      (text ? '<div class="t-sm" style="max-width:340px">' + esc(text) + '</div>' : '') +
      '</div>' + (actionHTML || '') + '</div>';
  };

  ui.metaRow = function (label, value) {
    return '<div class="row" style="gap:10px;justify-content:space-between"><span class="t-sm faint">' +
      esc(label) + '</span><span class="t-sm">' + esc(value) + '</span></div>';
  };

  /* --------------------------------------------------- caja de texto viva */
  ui.autoGrow = function (textarea, max) {
    const grow = function () {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, max || 168) + 'px';
    };
    textarea.addEventListener('input', grow);
    grow();
    return grow;
  };

  /* --------------------------------------------------------------- sonido */
  /* Tonos cortos sintetizados: sin archivos, sin latencia de red.
     Sólo en momentos con significado (entrante, envío, error).            */
  let actx = null;
  ui.sound = function (kind) {
    const st = NS.store.state;
    if (st && st.settings && !st.settings.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      actx = actx || new Ctx();
      if (actx.state === 'suspended') actx.resume();
      const notes = {
        in: [[880, 0], [1174, .07]],
        out: [[660, 0]],
        error: [[300, 0], [220, .09]],
        done: [[784, 0], [1046, .06], [1318, .12]]
      }[kind] || [[660, 0]];
      notes.forEach(function (n) {
        const o = actx.createOscillator(), g = actx.createGain();
        const t0 = actx.currentTime + n[1];
        o.type = 'sine';
        o.frequency.setValueAtTime(n[0], t0);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(kind === 'error' ? .06 : .045, t0 + .012);
        g.gain.exponentialRampToValueAtTime(.0001, t0 + .18);
        o.connect(g); g.connect(actx.destination);
        o.start(t0); o.stop(t0 + .2);
      });
    } catch (e) { /* sin audio disponible */ }
  };

  ui.notify = function (title, body, onClick) {
    const st = NS.store.state;
    if (!st || !st.settings.desktopNotifications) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body: body, tag: 'nexo-crm', silent: true });
      if (onClick) n.onclick = function () { window.focus(); onClick(); n.close(); };
    } catch (e) { }
  };

  ui.requestNotifications = function () {
    if (!('Notification' in window)) {
      ui.toast('Este navegador no soporta notificaciones', 'warn');
      return Promise.resolve(false);
    }
    return Notification.requestPermission().then(function (p) { return p === 'granted'; });
  };

  /* ------------------------------------- desplazamiento con resorte suave */
  ui.scrollToBottom = function (node, animate) {
    if (!node) return;
    const target = node.scrollHeight - node.clientHeight;
    if (!animate || NS.motion.reduced()) { node.scrollTop = target; return; }
    NS.motion.spring({
      from: node.scrollTop, to: target, response: 0.42, damping: 1.0, epsilon: 0.5,
      onUpdate: function (v) { node.scrollTop = v; }
    });
  };

})(window.CRM);
