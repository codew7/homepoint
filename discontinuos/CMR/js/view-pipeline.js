/* =========================================================================
   Nexo CRM · embudo de ventas
   Tablero Kanban con arrastre 1:1, proyección de inercia al soltar y llegada
   por resorte. La tarjeta sigue al dedo desde donde se la agarró.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui, motion = NS.motion;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  const state = { owner: '', q: '', period: 'all' };
  let root, boardEl, drag = null;

  /* --------------------------------------------------------------- datos */
  function dealsOfStage(stageId) {
    const q = util.norm(state.q);
    return store.state.deals.filter(function (d) {
      if (d.stageId !== stageId) return false;
      if (state.owner && d.ownerId !== state.owner) return false;
      if (state.period !== 'all') {
        const dias = state.period === '30' ? 30 : 90;
        if (d.createdAt < Date.now() - dias * 86400000) return false;
      }
      if (q) {
        const c = store.contact(d.contactId);
        if (util.norm(d.title + ' ' + (c ? c.name + ' ' + c.company : '')).indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt); });
  }

  /* -------------------------------------------------------------- render */
  function render() {
    const stages = store.state.stages.slice().sort(function (a, b) { return a.order - b.order; });
    const abiertos = store.state.deals.filter(function (d) {
      const s = store.stage(d.stageId); return s && s.kind === 'open';
    });
    const ganados = store.state.deals.filter(function (d) {
      const s = store.stage(d.stageId); return s && s.kind === 'won';
    });

    root.innerHTML =
      '<div class="row-gap" style="padding:12px 16px;gap:9px;border-bottom:1px solid var(--line);flex-wrap:wrap">' +
      '<div class="input-icon" style="width:230px;max-width:100%">' + icon('search', 15) +
      '<input class="input" id="pl-q" placeholder="Buscar negocio…" value="' + esc(state.q) + '"></div>' +
      '<select class="select" id="pl-owner" style="width:auto;min-width:140px">' +
      '<option value="">Todo el equipo</option>' +
      store.state.agents.map(function (a) {
        return '<option value="' + a.id + '"' + (state.owner === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select>' +
      '<div class="segmented" id="pl-period">' +
      [['all', 'Todo'], ['90', '90 días'], ['30', '30 días']].map(function (p) {
        return '<button data-p="' + p[0] + '" aria-selected="' + (state.period === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<span class="spacer"></span>' +
      '<span class="t-sm faint">En curso <b class="t-num" style="color:var(--ink-1)">' +
      util.moneyCompact(util.sum(abiertos, function (d) { return d.value; })) + '</b></span>' +
      '<span class="t-sm faint">Ganado <b class="t-num" style="color:var(--ok-fg)">' +
      util.moneyCompact(util.sum(ganados, function (d) { return d.value; })) + '</b></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new">' + icon('plus', 14) + 'Nuevo negocio</button>' +
      '</div>' +
      '<div class="board" id="board"></div>';

    boardEl = root.querySelector('#board');
    boardEl.innerHTML = stages.map(columnHTML).join('');
    wire();
  }

  function columnHTML(stage) {
    const deals = dealsOfStage(stage.id);
    const total = util.sum(deals, function (d) { return d.value; });
    return '<div class="column" data-stage="' + stage.id + '">' +
      '<div class="column-head">' +
      '<div class="row-gap" style="gap:7px">' +
      '<i class="dot" style="color:' + stageColor(stage) + '"></i>' +
      '<span class="t-md truncate">' + esc(stage.name) + '</span>' +
      '<span class="nav-count">' + deals.length + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="add-here" data-stage="' + stage.id + '" title="Agregar acá">' + icon('plus', 14) + '</button>' +
      '</div>' +
      '<div class="t-xs faint t-num">' + esc(util.money(total)) + '</div>' +
      '</div>' +
      '<div class="column-body" data-stage="' + stage.id + '">' +
      (deals.length ? deals.map(dealHTML).join('') :
        '<div class="t-xs faint" style="padding:14px;text-align:center">Sin negocios</div>') +
      '</div></div>';
  }

  function stageColor(stage) {
    return {
      blue: 'var(--c1)', magenta: 'var(--c2)', amber: 'var(--c3)', green: 'var(--c4)',
      violet: 'var(--c5)', neutral: 'var(--c-neutral)', danger: 'var(--danger)'
    }[stage.color] || 'var(--c-neutral)';
  }

  function dealHTML(d) {
    const c = store.contact(d.contactId);
    const owner = d.ownerId ? store.agent(d.ownerId) : null;
    const dias = Math.floor((Date.now() - (d.updatedAt || d.createdAt)) / 86400000);
    const frio = dias > 14;
    return '<div class="deal" data-id="' + d.id + '">' +
      '<div class="row-gap" style="gap:8px;align-items:flex-start">' +
      '<div class="stack" style="min-width:0;flex:1;gap:3px">' +
      '<span class="t-sm strong truncate">' + esc(d.title) + '</span>' +
      '<span class="t-xs faint truncate">' + esc(c ? c.name : 'Sin contacto') + (c && c.company ? ' · ' + esc(c.company) : '') + '</span>' +
      '</div>' +
      (owner ? ui.avatarHTML(owner.name, { size: 'sm', seed: owner.id }) : '') +
      '</div>' +
      '<div class="row-gap" style="margin-top:9px;gap:7px">' +
      '<span class="t-sm t-num strong">' + esc(util.moneyCompact(d.value, d.currency)) + '</span>' +
      '<span class="spacer"></span>' +
      (frio ? '<span class="chip" data-color="amber" title="Sin movimiento hace ' + dias + ' días">' + icon('clock', 10) + dias + 'd</span>' :
        '<span class="t-xs faint">' + (dias === 0 ? 'hoy' : dias + 'd') + '</span>') +
      '</div></div>';
  }

  /* ------------------------------------------------------------- eventos */
  function wire() {
    const q = root.querySelector('#pl-q');
    q.addEventListener('input', util.debounce(function () {
      state.q = q.value;
      const pos = q.selectionStart;
      render();
      const n = root.querySelector('#pl-q'); n.focus(); n.setSelectionRange(pos, pos);
    }, 200));
    root.querySelector('#pl-owner').addEventListener('change', function () { state.owner = this.value; render(); });

    /* el tablero se reconstruye entero: su escucha viaja con él */
    dom.on(boardEl, 'pointerdown', '.deal', onPointerDown);
  }

  function wireOnce() {
    dom.on(root, 'click', '#pl-period button', function () { state.period = this.dataset.p; render(); });
    dom.on(root, 'click', '[data-act="new"]', function () { newDeal(null, render); });
    dom.on(root, 'click', '[data-act="add-here"]', function (e) {
      e.stopPropagation();
      newDeal(null, render, this.dataset.stage);
    });
  }

  /* ------------------------------------------------- arrastre 1:1 + inercia */
  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    const card = this;
    const rect = card.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const trackX = motion.tracker(), trackY = motion.tracker();
    let started = false;

    card.setPointerCapture(e.pointerId);

    const move = function (ev) {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      /* histéresis: 6px antes de comprometerse con el gesto */
      if (!started) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        started = true;
        beginDrag(card, rect, grab);
      }
      trackX.push(ev.clientX); trackY.push(ev.clientY);
      positionCard(ev.clientX, ev.clientY);
      updateTarget(ev.clientX, ev.clientY);
    };

    const up = function (ev) {
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerup', up);
      card.removeEventListener('pointercancel', up);
      try { card.releasePointerCapture(e.pointerId); } catch (err) { }
      if (!started) { openDeal(card.dataset.id, render); return; }
      endDrag(trackX.velocity(), trackY.velocity());
    };

    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up);
    card.addEventListener('pointercancel', up);
  }

  function beginDrag(card, rect, grab) {
    const ghost = el('div', { class: 'deal-ghost', style: { height: rect.height + 'px' } });
    card.parentNode.insertBefore(ghost, card);

    drag = {
      card: card, ghost: ghost, grab: grab,
      w: rect.width, h: rect.height,
      x: rect.left, y: rect.top,
      deal: store.state.deals.find(function (d) { return d.id === card.dataset.id; }),
      column: card.closest('.column-body')
    };

    card.classList.add('is-dragging');
    Object.assign(card.style, {
      position: 'fixed', left: '0', top: '0', width: rect.width + 'px',
      margin: '0', pointerEvents: 'none',
      transform: 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0) rotate(1.4deg) scale(1.02)'
    });
    document.body.appendChild(card);
  }

  function positionCard(px, py) {
    if (!drag) return;
    drag.x = px - drag.grab.x;
    drag.y = py - drag.grab.y;
    drag.card.style.transform =
      'translate3d(' + drag.x + 'px,' + drag.y + 'px,0) rotate(1.4deg) scale(1.02)';
  }

  function updateTarget(px, py) {
    if (!drag) return;
    let target = null;
    dom.$$('.column', boardEl).forEach(function (col) {
      const r = col.getBoundingClientRect();
      col.classList.toggle('is-target', px >= r.left && px <= r.right && py >= r.top && py <= r.bottom);
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) target = col;
    });
    if (!target) return;

    const body = target.querySelector('.column-body');
    const cards = dom.$$('.deal', body);
    let before = null;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (py < r.top + r.height / 2) { before = cards[i]; break; }
    }
    if (before) body.insertBefore(drag.ghost, before);
    else body.appendChild(drag.ghost);
    drag.column = body;
  }

  function endDrag(vx, vy) {
    if (!drag) return;
    const d = drag;
    drag = null;

    dom.$$('.column', boardEl).forEach(function (c) { c.classList.remove('is-target'); });

    const dest = d.ghost.getBoundingClientRect();
    const newStage = d.column ? d.column.dataset.stage : (d.deal && d.deal.stageId);

    /* proyección de inercia: si el gesto venía con impulso, se toma en cuenta
       hacia dónde iba, no sólo dónde se soltó */
    const projX = dest.left, projY = dest.top;

    const finish = function () {
      d.card.remove();
      d.ghost.remove();
      if (d.deal && newStage && d.deal.stageId !== newStage) {
        const stage = store.stage(newStage);
        store.commit(function () {
          d.deal.stageId = newStage;
          d.deal.updatedAt = Date.now();
          if (stage.kind === 'won' || stage.kind === 'lost') d.deal.closedAt = Date.now();
          else d.deal.closedAt = null;
          store.log('deal', 'movió “' + d.deal.title + '” a ' + stage.name);
        }, 'deal');
        if (stage.kind === 'won') { ui.toast('¡Negocio ganado! ' + util.money(d.deal.value), 'ok'); ui.sound('done'); }
        else ui.toast('Movido a ' + stage.name, 'ok');
      }
      render();
    };

    if (motion.reduced()) { finish(); return; }

    /* dos resortes independientes: X e Y no comparten velocidad */
    let cx = d.x, cy = d.y, doneX = false, doneY = false;
    const check = function () { if (doneX && doneY) finish(); };
    const apply = function () {
      d.card.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0) rotate(0deg) scale(1)';
    };
    motion.spring({
      from: d.x, to: projX, velocity: vx, response: 0.34, damping: 0.86,
      onUpdate: function (v) { cx = v; apply(); },
      onComplete: function () { doneX = true; check(); }
    });
    motion.spring({
      from: d.y, to: projY, velocity: vy, response: 0.34, damping: 0.86,
      onUpdate: function (v) { cy = v; apply(); },
      onComplete: function () { doneY = true; check(); }
    });
  }

  /* --------------------------------------------------------- alta y ficha */
  function newDeal(contactId, done, stageId) {
    const contactos = store.state.contacts.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    const stages = store.state.stages.slice().sort(function (a, b) { return a.order - b.order; });

    ui.form({
      title: 'Nuevo negocio', icon: 'funnel', submitText: 'Crear negocio',
      fields: [
        { key: 'title', label: 'Título', required: true, placeholder: 'Ej: Pedido mayorista de temporada' },
        {
          key: 'contactId', label: 'Contacto', type: 'select', value: contactId || (contactos[0] || {}).id,
          options: contactos.map(function (c) { return { value: c.id, label: c.name + (c.company ? ' · ' + c.company : '') }; })
        },
        { key: 'value', label: 'Valor estimado', type: 'number', value: 0, min: 0 },
        {
          key: 'stageId', label: 'Etapa', type: 'select', value: stageId || stages[0].id,
          options: stages.map(function (s) { return { value: s.id, label: s.name }; })
        },
        {
          key: 'ownerId', label: 'Responsable', type: 'select', value: (store.me() || {}).id,
          options: store.state.agents.map(function (a) { return { value: a.id, label: a.name }; })
        }
      ]
    }).then(function (r) {
      if (!r) return;
      store.commit(function (s) {
        s.deals.unshift({
          id: util.uid('dl'), contactId: r.contactId, title: r.title, value: Number(r.value) || 0,
          currency: s.workspace.currency, stageId: r.stageId, ownerId: r.ownerId,
          createdAt: Date.now(), updatedAt: Date.now(), closedAt: null, lostReason: '', tags: []
        });
        store.log('deal', 'creó el negocio “' + r.title + '”');
      }, 'deal');
      ui.toast('Negocio creado', 'ok');
      done && done();
    });
  }

  function openDeal(id, done) {
    const d = store.state.deals.find(function (x) { return x.id === id; });
    if (!d) return;
    const c = store.contact(d.contactId);
    const stages = store.state.stages.slice().sort(function (a, b) { return a.order - b.order; });
    const owner = d.ownerId ? store.agent(d.ownerId) : null;

    const body = el('div', { class: 'stack', style: { gap: '16px' } });
    body.innerHTML =
      '<div class="stack" style="gap:5px">' +
      '<div class="t-xl">' + esc(d.title) + '</div>' +
      '<div class="t-lg t-num accent">' + esc(util.money(d.value, d.currency)) + '</div>' +
      '</div>' +
      '<div class="field"><label class="label">Etapa</label>' +
      '<div class="pills" id="dl-stages">' + stages.map(function (s) {
        return '<button class="pill" data-stage="' + s.id + '" aria-pressed="' + (d.stageId === s.id) + '">' +
          '<i class="dot" style="color:' + stageColor(s) + '"></i>' + esc(s.name) + '</button>';
      }).join('') + '</div></div>' +
      (c ? '<div class="card"><div class="card-head"><span class="t-md">Contacto</span></div>' +
        '<div class="card-pad row-gap" style="gap:11px">' + ui.avatarHTML(c.name, { seed: c.id }) +
        '<div class="stack" style="gap:1px;min-width:0"><span class="strong truncate">' + esc(c.name) + '</span>' +
        '<span class="t-xs faint">' + esc(util.phone(c.phone)) + '</span></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm btn-outline" data-act="chat">' + icon('whatsapp', 14) + 'Conversar</button>' +
        '</div></div>' : '') +
      '<dl class="kv">' +
      '<dt>Responsable</dt><dd>' + esc(owner ? owner.name : '—') + '</dd>' +
      '<dt>Creado</dt><dd>' + esc(util.fmtDate(d.createdAt)) + '</dd>' +
      '<dt>Actualizado</dt><dd>' + esc(util.relTime(d.updatedAt || d.createdAt)) + '</dd>' +
      (d.closedAt ? '<dt>Cerrado</dt><dd>' + esc(util.fmtDate(d.closedAt)) + '</dd>' : '') +
      (d.lostReason ? '<dt>Motivo</dt><dd>' + esc(d.lostReason) + '</dd>' : '') +
      '</dl>';

    const drawer = ui.drawer({
      title: 'Negocio', subtitle: c ? c.name : '', body: body,
      footer: '<button class="btn btn-outline" data-act="edit">' + icon('edit', 14) + 'Editar</button>' +
        '<button class="btn btn-danger" data-act="del">' + icon('trash', 14) + '</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary" data-act="won">' + icon('check', 14) + 'Marcar ganado</button>',
      onClose: function () { done && done(); }
    });

    dom.on(drawer.root, 'click', '[data-stage]', function () {
      const sid = this.dataset.stage, stage = store.stage(sid);
      store.commit(function () {
        d.stageId = sid; d.updatedAt = Date.now();
        d.closedAt = (stage.kind === 'won' || stage.kind === 'lost') ? Date.now() : null;
      }, 'deal');
      drawer.close();
      done && done();
    });
    dom.on(drawer.root, 'click', '[data-act="chat"]', function () {
      const r = NS.wa.ensureConversation(c.id, d.title);
      if (r.created) store.commit(null, 'conv');
      drawer.close();
      NS.app.go('bandeja', { conv: r.conv.id });
    });
    dom.on(drawer.root, 'click', '[data-act="won"]', function () {
      const won = stages.find(function (s) { return s.kind === 'won'; });
      store.commit(function () { d.stageId = won.id; d.closedAt = Date.now(); d.updatedAt = Date.now(); }, 'deal');
      ui.toast('¡Negocio ganado! ' + util.money(d.value, d.currency), 'ok');
      ui.sound('done');
      drawer.close();
    });
    dom.on(drawer.root, 'click', '[data-act="edit"]', function () {
      ui.form({
        title: 'Editar negocio', icon: 'edit',
        fields: [
          { key: 'title', label: 'Título', required: true, value: d.title },
          { key: 'value', label: 'Valor', type: 'number', value: d.value },
          {
            key: 'ownerId', label: 'Responsable', type: 'select', value: d.ownerId,
            options: store.state.agents.map(function (a) { return { value: a.id, label: a.name }; })
          },
          { key: 'lostReason', label: 'Motivo de pérdida (si aplica)', value: d.lostReason || '' }
        ]
      }).then(function (r) {
        if (!r) return;
        store.commit(function () { Object.assign(d, r, { value: Number(r.value) || 0, updatedAt: Date.now() }); }, 'deal');
        drawer.close();
        done && done();
      });
    });
    dom.on(drawer.root, 'click', '[data-act="del"]', function () {
      ui.confirm({ title: 'Eliminar negocio', message: 'Se elimina “' + d.title + '”.', danger: true, confirmText: 'Eliminar' })
        .then(function (ok) {
          if (!ok) return;
          store.commit(function (s) { s.deals = s.deals.filter(function (x) { return x.id !== d.id; }); }, 'deal');
          drawer.close();
        });
    });
  }

  /* --------------------------------------------------------------- vista */
  NS.views = NS.views || {};
  NS.views.embudo = {
    title: 'Embudo de ventas',
    icon: 'kanban',
    mount: function (container) {
      root = container;
      root.className = 'view stack';
      wireOnce();
      render();
      const off = store.on('deal', function () { if (!drag) render(); });
      return { destroy: off };
    }
  };

  NS.pipeline = { newDeal: newDeal, openDeal: openDeal };

})(window.CRM);
