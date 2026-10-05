/* =========================================================================
   Nexo CRM · armazón
   Arranque, navegación, cromo superior, paleta de comandos, atajos de
   teclado y asistente de configuración inicial.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui, wa = NS.wa;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  const NAV = [
    { k: 'bandeja', view: 'inbox', label: 'Bandeja', icon: 'inbox', group: 'Atención' },
    { k: 'contactos', view: 'contactos', label: 'Contactos', icon: 'users', group: 'Atención' },
    { k: 'embudo', view: 'embudo', label: 'Embudo', icon: 'kanban', group: 'Ventas' },
    { k: 'campanas', view: 'campanas', label: 'Campañas', icon: 'megaphone', group: 'Ventas' },
    { k: 'automatizaciones', view: 'automatizaciones', label: 'Automatizaciones', icon: 'bolt', group: 'Sistema' },
    { k: 'metricas', view: 'metricas', label: 'Métricas', icon: 'chart', group: 'Sistema' },
    { k: 'ajustes', view: 'ajustes', label: 'Ajustes', icon: 'gear', group: 'Sistema' }
  ];

  const app = NS.app = {};
  let current = null, currentKey = null, pendingParams = null, appEl, viewEl, mq;

  /* ---------------------------------------------------------------- tema */
  app.applyTheme = function () {
    const s = store.state.settings;
    let theme = s.theme;
    if (theme === 'auto') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-density', s.density || 'comfortable');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f2efe8' : '#0b0c0d');
  };

  /* ------------------------------------------------------------ navegación */
  app.go = function (key, params) {
    pendingParams = params || null;
    if (location.hash === '#/' + key) route();
    else location.hash = '#/' + key;
  };

  function route() {
    const key = (location.hash.replace(/^#\/?/, '') || 'bandeja').split('?')[0];
    const entry = NAV.find(function (n) { return n.k === key; }) || NAV[0];
    const view = NS.views[entry.view];
    if (!view) return;

    if (current && current.destroy) { try { current.destroy(); } catch (e) { console.warn(e); } }
    NS.chart && NS.chart.hideTip();
    ui.closeMenu();

    currentKey = entry.k;
    /* nodo nuevo en cada navegación: ningún escucha de la vista anterior
       sobrevive, y las vistas pueden delegar sobre su raíz sin acumular */
    const fresh = el('main', { class: 'view', id: 'view' });
    viewEl.parentNode.replaceChild(fresh, viewEl);
    viewEl = fresh;
    current = view.mount(viewEl, pendingParams) || {};
    pendingParams = null;

    renderNav();
    renderTopbar(view);
    document.title = view.title + ' · ' + store.state.workspace.name;
  }

  app.openConversation = function (id) { app.go('bandeja', { conv: id }); };

  /* --------------------------------------------------------- barra lateral */
  function renderNav() {
    const rail = dom.$('#rail');
    const st = store.state;
    const sinLeer = st.conversations.filter(function (c) { return c.unread; }).length;
    const pendientes = st.tasks.filter(function (t) { return !t.done && t.dueAt < Date.now(); }).length;
    const me = store.me();

    const counts = {
      bandeja: sinLeer,
      contactos: 0,
      embudo: st.deals.filter(function (d) { const s = store.stage(d.stageId); return s && s.kind === 'open'; }).length,
      campanas: st.campaigns.filter(function (c) { return c.status === 'enviando' || c.status === 'programada'; }).length,
      automatizaciones: st.automations.filter(function (a) { return a.active; }).length,
      metricas: 0, ajustes: 0
    };

    let html =
      '<div class="rail-brand">' +
      '<div class="brand-mark">N</div>' +
      '<div class="brand-text">' +
      '<div class="brand-name truncate">' + esc(st.workspace.name) + '</div>' +
      '<div class="brand-sub truncate">Nexo CRM</div>' +
      '</div></div>';

    let grupo = null;
    NAV.forEach(function (n) {
      if (n.group !== grupo) { grupo = n.group; html += '<div class="rail-section">' + esc(grupo) + '</div>'; }
      const c = counts[n.k];
      html += '<a class="nav-item" href="#/' + n.k + '" data-nav="' + n.k + '"' +
        (currentKey === n.k ? ' aria-current="page"' : '') + ' title="' + esc(n.label) + '">' +
        icon(n.icon, 18) +
        '<span class="nav-label">' + esc(n.label) + '</span>' +
        (c ? '<span class="nav-count' + (n.k === 'bandeja' ? ' is-hot' : '') + '">' + c + '</span>' : '') +
        '</a>';
    });

    html += '<div class="rail-foot">' +
      '<button class="nav-item" data-act="tasks" title="Tareas">' + icon('task', 18) +
      '<span class="nav-label">Tareas</span>' +
      (pendientes ? '<span class="nav-count is-hot">' + pendientes + '</span>' : '') + '</button>' +
      '<button class="nav-item" data-act="theme" title="Cambiar tema">' +
      icon(document.documentElement.getAttribute('data-theme') === 'light' ? 'moon' : 'sun', 18) +
      '<span class="nav-label">Tema</span></button>' +
      '<button class="rail-user" data-act="me" title="' + esc(me ? me.name : '') + '">' +
      (me ? ui.avatarHTML(me.name, { size: 'sm', seed: me.id, status: me.status }) : '') +
      '<span class="stack rail-foot-name" style="gap:0;min-width:0;text-align:left">' +
      '<span class="t-sm strong truncate">' + esc(me ? me.name : '—') + '</span>' +
      '<span class="t-xs faint truncate">' + esc(me ? me.role : '') + '</span>' +
      '</span></button>' +
      '</div>';

    rail.innerHTML = html;
  }

  /* ------------------------------------------------------------- cromo */
  function renderTopbar(view) {
    const bar = dom.$('#topbar');
    const c = store.state.connection;
    const modo = c.mode;

    bar.innerHTML =
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="rail" title="Contraer menú">' + icon('list', 17) + '</button>' +
      '<div class="topbar-title">' +
      '<span class="t-lg t-serif truncate">' + esc(view.title) + '</span>' +
      '</div>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-outline" data-act="palette" style="gap:9px">' +
      icon('search', 15) + '<span class="hide-narrow">Buscar o ejecutar</span>' +
      '<span class="kbd-inline"><span class="kbd">Ctrl</span><span class="kbd">K</span></span></button>' +
      '<span class="badge-conn" data-mode="' + esc(modo) + '" title="' + esc(wa.modeLabel()) + '">' +
      '<i class="live-dot"></i><span class="hide-narrow">' + esc(wa.modeLabel()) + '</span></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new-chat">' + icon('plus', 15) +
      '<span class="hide-narrow">Nueva conversación</span></button>';
  }

  app.refreshChrome = function () {
    renderNav();
    const view = NS.views[(NAV.find(function (n) { return n.k === currentKey; }) || NAV[0]).view];
    if (view) renderTopbar(view);
  };

  function wireChrome() {
    const shell = dom.$('#shell');

    dom.on(shell, 'click', '[data-act="rail"]', function () {
      appEl.dataset.rail = appEl.dataset.rail === 'min' ? 'full' : 'min';
      try { localStorage.setItem('nexo.rail', appEl.dataset.rail); } catch (e) { }
    });
    dom.on(shell, 'click', '[data-act="theme"]', function () {
      const cur = document.documentElement.getAttribute('data-theme');
      store.commit(function (s) { s.settings.theme = cur === 'light' ? 'dark' : 'light'; }, 'settings');
      app.applyTheme();
      app.refreshChrome();
    });
    dom.on(shell, 'click', '[data-act="palette"]', function () { palette(); });
    dom.on(shell, 'click', '[data-act="new-chat"]', newChat);
    dom.on(shell, 'click', '[data-act="tasks"]', function () { tasksPanel(this); });
    dom.on(shell, 'click', '[data-act="me"]', function () { mePanel(this); });
  }

  /* ------------------------------------------------------ nueva conversación */
  function newChat() {
    const contactos = store.state.contacts.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    const wrap = el('div', { class: 'stack', style: { gap: '14px' } });
    wrap.innerHTML =
      '<div class="segmented" id="nc-tabs">' +
      '<button data-t="existing" aria-selected="true">Contacto existente</button>' +
      '<button data-t="new" aria-selected="false">Número nuevo</button>' +
      '</div>' +
      '<div id="nc-body"></div>';

    let tab = 'existing';
    const drawBody = function () {
      const b = wrap.querySelector('#nc-body');
      if (tab === 'existing') {
        b.innerHTML =
          '<div class="input-icon">' + icon('search', 15) +
          '<input class="input" id="nc-q" placeholder="Buscar contacto…" autocomplete="off"></div>' +
          '<div class="scroll" id="nc-list" style="max-height:260px;margin-top:10px"></div>';
        const drawList = function (q) {
          const nq = util.norm(q || '');
          const list = contactos.filter(function (c) {
            return !nq || util.norm(c.name + ' ' + c.phone + ' ' + (c.company || '')).indexOf(nq) >= 0;
          }).slice(0, 40);
          b.querySelector('#nc-list').innerHTML = list.length ? list.map(function (c) {
            return '<div class="mini-item" data-pick="' + c.id + '">' + ui.avatarHTML(c.name, { size: 'sm', seed: c.id }) +
              '<div class="stack" style="gap:0;min-width:0"><span class="t-sm strong truncate">' + esc(c.name) + '</span>' +
              '<span class="t-xs faint">' + esc(util.phone(c.phone)) + '</span></div></div>';
          }).join('') : '<div class="t-sm faint" style="padding:12px">Sin resultados.</div>';
        };
        drawList('');
        b.querySelector('#nc-q').addEventListener('input', function () { drawList(this.value); });
      } else {
        b.innerHTML =
          '<div class="field"><label class="label">Teléfono con código de país</label>' +
          '<input class="input" id="nc-phone" placeholder="5491133445566" value="549"></div>' +
          '<div class="field" style="margin-top:12px"><label class="label">Nombre</label>' +
          '<input class="input" id="nc-name" placeholder="Nombre del contacto"></div>';
      }
    };
    drawBody();

    const modal = ui.modal({
      title: 'Nueva conversación', icon: 'whatsapp', body: wrap,
      actions: [{ label: 'Cancelar' }, {
        label: 'Abrir chat', variant: 'primary', keepOpen: true, onClick: function (api) {
          if (tab === 'new') {
            const phone = util.phoneRaw(wrap.querySelector('#nc-phone').value);
            const name = wrap.querySelector('#nc-name').value.trim();
            if (phone.length < 8) { ui.toast('Teléfono incompleto', 'warn'); return false; }
            const c = wa.ensureContact(phone, name || util.phone(phone));
            const r = wa.ensureConversation(c.id, 'Conversación');
            store.commit(null, 'conv');
            api.close();
            app.go('bandeja', { conv: r.conv.id });
          } else {
            ui.toast('Elegí un contacto de la lista', 'warn');
            return false;
          }
        }
      }]
    });

    dom.on(wrap, 'click', '#nc-tabs button', function () {
      tab = this.dataset.t;
      dom.$$('#nc-tabs button', wrap).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.t === tab); });
      drawBody();
    });
    dom.on(wrap, 'click', '[data-pick]', function () {
      const r = wa.ensureConversation(this.dataset.pick, 'Conversación');
      store.commit(null, 'conv');
      modal.close();
      app.go('bandeja', { conv: r.conv.id });
    });
  }

  /* ------------------------------------------------------------- tareas */
  function tasksPanel(anchor) {
    const st = store.state;
    const abiertas = st.tasks.filter(function (t) { return !t.done; })
      .sort(function (a, b) { return a.dueAt - b.dueAt; });

    const body = el('div', { class: 'stack', style: { gap: '10px' } });
    body.innerHTML = abiertas.length ? abiertas.map(function (t) {
      const c = store.contact(t.contactId);
      const vencida = t.dueAt < Date.now();
      return '<div class="mini-item" style="cursor:default">' +
        '<button class="check" role="checkbox" aria-checked="false" data-done="' + t.id + '">' + icon('check', 12) + '</button>' +
        '<div class="stack" style="gap:2px;min-width:0;flex:1">' +
        '<span class="t-sm truncate">' + esc(t.title) + '</span>' +
        '<span class="t-xs ' + (vencida ? '' : 'faint') + '" style="' + (vencida ? 'color:var(--danger-fg)' : '') + '">' +
        (vencida ? 'Vencida · ' : '') + esc(util.fmtDateShort(t.dueAt)) + ' ' + esc(util.fmtTime(t.dueAt)) +
        (c ? ' · ' + esc(c.name) : '') + '</span>' +
        '</div>' +
        (c ? '<button class="btn btn-ghost btn-icon btn-sm" data-open="' + c.id + '">' + icon('inbox', 15) + '</button>' : '') +
        '</div>';
    }).join('') : ui.empty('task', 'Sin tareas pendientes', 'Cuando agendes un seguimiento aparecerá acá.');

    const drawer = ui.drawer({ title: 'Tareas', subtitle: abiertas.length + ' pendientes', body: body });

    dom.on(drawer.root, 'click', '[data-done]', function () {
      const id = this.dataset.done;
      this.setAttribute('aria-checked', 'true');
      setTimeout(function () {
        store.commit(function (s) {
          const t = s.tasks.find(function (x) { return x.id === id; });
          if (t) t.done = true;
        }, 'task');
        drawer.close();
        app.refreshChrome();
        ui.toast('Tarea completada', 'ok');
      }, 200);
    });
    dom.on(drawer.root, 'click', '[data-open]', function () {
      const r = wa.ensureConversation(this.dataset.open, 'Conversación');
      store.commit(null, 'conv');
      drawer.close();
      app.go('bandeja', { conv: r.conv.id });
    });
  }

  function mePanel(anchor) {
    const me = store.me();
    ui.menu(anchor, [
      { group: me ? me.name : '' },
      { icon: 'users', label: 'Cambiar de agente', onClick: function () { NS.settings.go('equipo'); } },
      { icon: 'gear', label: 'Ajustes', onClick: function () { app.go('ajustes'); } },
      { icon: 'command', label: 'Atajos de teclado', onClick: shortcutsHelp },
      { sep: true },
      { icon: 'download', label: 'Descargar respaldo', onClick: function () {
          util.download('nexo-crm-' + new Date().toISOString().slice(0, 10) + '.json', store.export(), 'application/json');
          ui.toast('Respaldo descargado', 'ok');
        } },
      { icon: 'sparkle', label: 'Ver la guía inicial', onClick: function () { onboarding(true); } }
    ]);
  }

  /* ------------------------------------------------- paleta de comandos */
  function palette() {
    const overlay = el('div', { class: 'overlay palette-overlay' });
    const box = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true' });
    box.innerHTML =
      '<input class="palette-input" id="pl-input" placeholder="Buscar contactos, conversaciones o ejecutar una acción…" autocomplete="off">' +
      '<div class="palette-list" id="pl-list"></div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = box.querySelector('#pl-input');
    const list = box.querySelector('#pl-list');
    let items = [], active = 0;

    const close = function () {
      overlay.classList.add('closing');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(function () { overlay.remove(); }, 180);
    };
    overlay.addEventListener('pointerdown', function (e) { if (e.target === overlay) close(); });

    function build(q) {
      const nq = util.norm(q);
      const out = [];

      NAV.forEach(function (n) {
        if (!nq || util.norm(n.label).indexOf(nq) >= 0) {
          out.push({ icon: n.icon, label: n.label, hint: 'Ir a', run: function () { app.go(n.k); } });
        }
      });

      const acciones = [
        { icon: 'plus', label: 'Nueva conversación', run: newChat },
        { icon: 'users', label: 'Nuevo contacto', run: function () { NS.contacts.editContact(null, function () { app.go('contactos'); }); } },
        { icon: 'funnel', label: 'Nuevo negocio', run: function () { NS.pipeline.newDeal(null, function () { app.go('embudo'); }); } },
        { icon: 'megaphone', label: 'Nueva campaña', run: function () { app.go('campanas'); } },
        { icon: 'bolt', label: 'Nueva automatización', run: function () { app.go('automatizaciones'); } },
        { icon: 'sun', label: 'Cambiar tema claro / oscuro', run: function () { dom.$('[data-act="theme"]').click(); } },
        { icon: 'download', label: 'Descargar respaldo', run: function () {
            util.download('nexo-crm.json', store.export(), 'application/json');
          } },
        { icon: 'whatsapp', label: 'Configurar conexión con WhatsApp', run: function () { NS.settings.go('conexion'); } },
        { icon: 'command', label: 'Ver atajos de teclado', run: shortcutsHelp }
      ];
      acciones.forEach(function (a) {
        if (!nq || util.norm(a.label).indexOf(nq) >= 0) out.push(Object.assign({ hint: 'Acción' }, a));
      });

      if (nq.length >= 2) {
        store.state.contacts.filter(function (c) {
          return util.norm(c.name + ' ' + c.phone + ' ' + (c.company || '')).indexOf(nq) >= 0;
        }).slice(0, 8).forEach(function (c) {
          out.push({
            avatar: c, label: c.name, hint: util.phone(c.phone), run: function () {
              const r = wa.ensureConversation(c.id, 'Conversación');
              store.commit(null, 'conv');
              app.go('bandeja', { conv: r.conv.id });
            }
          });
        });
      }

      return out.slice(0, 20);
    }

    function draw() {
      list.innerHTML = items.length ? items.map(function (it, i) {
        return '<div class="palette-item' + (i === active ? ' is-active' : '') + '" data-i="' + i + '">' +
          (it.avatar ? ui.avatarHTML(it.avatar.name, { size: 'sm', seed: it.avatar.id }) : icon(it.icon, 17)) +
          '<span class="truncate">' + esc(it.label) + '</span>' +
          '<span class="spacer"></span>' +
          (it.hint ? '<span class="t-xs faint">' + esc(it.hint) + '</span>' : '') +
          '</div>';
      }).join('') : '<div class="t-sm faint" style="padding:16px">Sin resultados.</div>';
    }

    function run(i) {
      const it = items[i];
      if (!it) return;
      close();
      setTimeout(it.run, 60);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); draw(); scrollActive(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); scrollActive(); }
      if (e.key === 'Enter') { e.preventDefault(); run(active); }
    }
    function scrollActive() {
      const n = list.querySelector('.is-active');
      if (n) n.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function () { items = build(this.value); active = 0; draw(); });
    dom.on(list, 'click', '.palette-item', function () { run(Number(this.dataset.i)); });
    document.addEventListener('keydown', onKey, true);

    items = build('');
    draw();
    setTimeout(function () { input.focus(); }, 60);
  }

  /* ------------------------------------------------------------- atajos */
  const SHORTCUTS = [
    ['Ctrl / ⌘ + K', 'Abrir la paleta de comandos'],
    ['G luego B', 'Ir a la Bandeja'],
    ['G luego C', 'Ir a Contactos'],
    ['G luego E', 'Ir al Embudo'],
    ['G luego M', 'Ir a Métricas'],
    ['N', 'Nueva conversación'],
    ['/', 'Buscar en la lista de conversaciones'],
    ['Enter', 'Enviar el mensaje'],
    ['Shift + Enter', 'Salto de línea'],
    ['/atajo', 'Insertar una respuesta rápida'],
    ['Esc', 'Cerrar la ventana abierta'],
    ['?', 'Ver esta ayuda']
  ];

  function shortcutsHelp() {
    ui.modal({
      title: 'Atajos de teclado', icon: 'command',
      body: '<div class="stack" style="gap:9px">' + SHORTCUTS.map(function (s) {
        return '<div class="row" style="justify-content:space-between;gap:14px">' +
          '<span class="t-sm">' + esc(s[1]) + '</span>' +
          '<span class="kbd">' + esc(s[0]) + '</span></div>';
      }).join('') + '</div>',
      actions: [{ label: 'Entendido', variant: 'primary' }]
    });
  }

  function wireKeys() {
    let gPending = 0;
    document.addEventListener('keydown', function (e) {
      const t = e.target;
      const escribiendo = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); palette(); return;
      }
      if (escribiendo) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'g' || e.key === 'G') { gPending = Date.now(); return; }
      if (Date.now() - gPending < 1200) {
        const map = { b: 'bandeja', c: 'contactos', e: 'embudo', m: 'metricas', a: 'ajustes', k: 'campanas' };
        const k = map[String(e.key).toLowerCase()];
        if (k) { e.preventDefault(); gPending = 0; app.go(k); return; }
      }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newChat(); }
      if (e.key === '?') { e.preventDefault(); shortcutsHelp(); }
      if (e.key === '/') {
        const s = dom.$('#inbox-search');
        if (s) { e.preventDefault(); s.focus(); s.select(); }
      }
    });
  }

  /* ----------------------------------------------------------- onboarding */
  function onboarding(force) {
    if (store.state.meta.onboarded && !force) return;

    let step = 0;
    const datos = {
      name: store.state.workspace.name,
      mode: store.state.connection.mode,
      demo: store.state.meta.demo
    };

    const overlay = el('div', { class: 'overlay' });
    const box = el('div', { class: 'onb', role: 'dialog', 'aria-modal': 'true' });
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = function () {
      overlay.classList.add('closing');
      setTimeout(function () { overlay.remove(); }, 200);
    };

    function draw() {
      let html =
        '<div class="onb-hero">' +
        '<div class="t-eyebrow">Nexo CRM para WhatsApp</div>' +
        '<div class="t-display" style="margin-top:6px">' +
        ['Bienvenido.<br>Vamos a dejarlo listo en un minuto.',
          '¿Cómo querés conectar<br>WhatsApp?',
          'Todo listo,<br>' + esc((datos.name || 'tu equipo').split(' ')[0]) + '.'][step] +
        '</div>' +
        '<p class="t-sm muted" style="margin-top:10px;max-width:460px">' +
        ['Tres pasos: el nombre de tu negocio, cómo se conecta a WhatsApp y con qué datos arrancás.',
          'Podés cambiarlo cuando quieras desde Ajustes. Si recién empezás, la demostración es el mejor lugar.',
          'Ya podés atender, vender y medir. La guía vuelve a aparecer desde tu avatar, abajo a la izquierda.'][step] +
        '</p></div>' +
        '<div class="onb-steps">' + [0, 1, 2].map(function (i) {
          return '<div class="onb-step ' + (i < step ? 'done' : i === step ? 'now' : '') + '"><i></i></div>';
        }).join('') + '</div>' +
        '<div class="modal-body">';

      if (step === 0) {
        html += '<div class="field"><label class="label">Nombre de tu negocio</label>' +
          '<input class="input" id="ob-name" value="' + esc(datos.name) + '" placeholder="Ej: Maresia"></div>' +
          '<div class="field"><label class="label">¿Con qué datos querés arrancar?</label>' +
          '<div class="stack" style="gap:9px">' +
          '<button class="choice" data-demo="1" aria-checked="' + (datos.demo ? 'true' : 'false') + '">' +
          '<span class="choice-mark">' + icon('sparkle', 18) + '</span>' +
          '<span class="stack" style="gap:3px"><span class="t-sm strong">Con datos de ejemplo</span>' +
          '<span class="t-xs faint">32 contactos, conversaciones, negocios y métricas para explorar todo funcionando.</span></span></button>' +
          '<button class="choice" data-demo="0" aria-checked="' + (!datos.demo ? 'true' : 'false') + '">' +
          '<span class="choice-mark">' + icon('file', 18) + '</span>' +
          '<span class="stack" style="gap:3px"><span class="t-sm strong">Espacio limpio</span>' +
          '<span class="t-xs faint">Sólo las etiquetas, etapas y plantillas base. Para empezar a trabajar en serio.</span></span></button>' +
          '</div></div>';
      }

      if (step === 1) {
        html += '<div class="stack" style="gap:9px">' +
          [['demo', 'sparkle', 'Demostración', 'Todo simulado. Los mensajes llegan solos para que veas la bandeja en movimiento.'],
          ['link', 'link', 'Envío por enlace', 'Sin API ni costos: el CRM abre WhatsApp con el mensaje escrito y vos confirmás.'],
          ['cloud', 'whatsapp', 'API oficial de Meta', 'Envío automático, plantillas y campañas reales. Necesitás cuenta de WhatsApp Business.']]
            .map(function (m) {
              return '<button class="choice" data-mode="' + m[0] + '" aria-checked="' + (datos.mode === m[0]) + '">' +
                '<span class="choice-mark">' + icon(m[1], 18) + '</span>' +
                '<span class="stack" style="gap:3px"><span class="t-sm strong">' + m[2] + '</span>' +
                '<span class="t-xs faint">' + m[3] + '</span></span></button>';
            }).join('') + '</div>';
      }

      if (step === 2) {
        html += '<div class="stack" style="gap:11px">' +
          [['inbox', 'Bandeja', 'Todas las conversaciones en un solo lugar, con notas internas, etiquetas y asignación por agente.'],
          ['kanban', 'Embudo', 'Arrastrá cada oportunidad entre etapas y mirá cuánto tenés en juego.'],
          ['bolt', 'Automatizaciones', 'Saludos instantáneos, avisos fuera de horario y reparto entre el equipo.'],
          ['chart', 'Métricas', 'Tiempos de respuesta, volumen y rendimiento de cada persona.']]
            .map(function (f) {
              return '<div class="row-gap" style="gap:12px;align-items:flex-start">' +
                '<span class="choice-mark" style="background:var(--accent-soft);color:var(--accent)">' + icon(f[0], 17) + '</span>' +
                '<div class="stack" style="gap:2px;min-width:0"><span class="t-sm strong">' + f[1] + '</span>' +
                '<span class="t-xs faint">' + f[2] + '</span></div></div>';
            }).join('') + '</div>' +
          '<div class="callout" data-kind="info">' + icon('command', 16) +
          '<div>Consejo: <span class="kbd">Ctrl</span> <span class="kbd">K</span> abre la paleta de comandos desde cualquier pantalla.</div></div>';
      }

      html += '</div><div class="modal-foot">' +
        (step > 0 ? '<button class="btn btn-outline" data-act="back">Atrás</button>' : '') +
        '<button class="btn btn-ghost" data-act="skip">Saltar</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary btn-lg" data-act="next">' +
        (step === 2 ? 'Entrar al CRM' : 'Continuar') + icon('chevron', 15) + '</button>' +
        '</div>';

      box.innerHTML = html;
    }

    function finish() {
      const nombre = (dom.$('#ob-name') && dom.$('#ob-name').value) || datos.name;
      const rehacer = !datos.demo && store.state.meta.demo;
      if (rehacer) {
        const blank = NS.seed.blank(nombre);
        blank.connection.mode = datos.mode;
        store.state = blank;
      } else {
        store.state.workspace.name = nombre || store.state.workspace.name;
        store.state.connection.mode = datos.mode;
        store.state.meta.onboarded = true;
      }
      store.state.meta.onboarded = true;
      store.save();
      close();
      wa.restartServices();
      app.applyTheme();
      app.refreshChrome();
      route();
      ui.toast('¡Listo! Tu espacio está configurado', 'ok');
      ui.sound('done');
    }

    dom.on(box, 'click', '[data-act="next"]', function () {
      if (step === 0) {
        const n = dom.$('#ob-name');
        if (n) datos.name = n.value.trim() || datos.name;
      }
      if (step === 2) { finish(); return; }
      step++; draw();
    });
    dom.on(box, 'click', '[data-act="back"]', function () { step--; draw(); });
    dom.on(box, 'click', '[data-act="skip"]', function () {
      store.commit(function (s) { s.meta.onboarded = true; }, null);
      close();
    });
    dom.on(box, 'click', '[data-demo]', function () {
      datos.demo = this.dataset.demo === '1';
      draw();
    });
    dom.on(box, 'click', '[data-mode]', function () {
      datos.mode = this.dataset.mode;
      draw();
    });

    draw();
  }

  /* --------------------------------------------------------------- boot */
  function boot() {
    store.load();
    app.applyTheme();

    appEl = dom.$('#app');
    viewEl = dom.$('#view');
    try {
      const r = localStorage.getItem('nexo.rail');
      if (r) appEl.dataset.rail = r;
    } catch (e) { }

    wireChrome();
    wireKeys();

    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/bandeja';
    route();

    /* el tema automático sigue al sistema en vivo */
    if (window.matchMedia) {
      mq = window.matchMedia('(prefers-color-scheme: light)');
      const onMQ = function () { if (store.state.settings.theme === 'auto') app.applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onMQ); else mq.addListener(onMQ);
    }

    /* servicios de fondo */
    wa.startSimulator();
    wa.startBridge();
    NS.sync.autoStart();
    setInterval(function () { wa.checkNoReply(); }, 60000);

    /* la barra lateral refleja el estado sin volver a dibujar la vista */
    store.on('message', util.throttle(renderNav, 800));
    store.on('task', renderNav);
    store.on('conv', util.throttle(renderNav, 800));
    store.on('read', util.throttle(renderNav, 400));

    /* título de pestaña con los mensajes sin leer */
    setInterval(function () {
      const n = store.state.conversations.filter(function (c) { return c.unread; }).length;
      const base = (NS.views[(NAV.find(function (x) { return x.k === currentKey; }) || NAV[0]).view] || {}).title || 'Nexo CRM';
      document.title = (n ? '(' + n + ') ' : '') + base + ' · ' + store.state.workspace.name;
    }, 4000);

    dom.$('#boot').remove();
    onboarding(false);
  }

  app.boot = boot;
  app.palette = palette;
  app.onboarding = onboarding;
  app.newChat = newChat;
  app.shortcuts = shortcutsHelp;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.CRM);
