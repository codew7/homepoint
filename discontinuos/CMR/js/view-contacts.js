/* =========================================================================
   Nexo CRM · contactos
   Listado con búsqueda, filtros, acciones en lote, importación y ficha 360.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui, wa = NS.wa;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  const state = { q: '', tag: '', sort: 'recent', dir: -1, page: 1, perPage: 40, selected: {} };
  let root, bodyEl;

  /* --------------------------------------------------------------- datos */
  function rows() {
    const q = util.norm(state.q);
    let list = store.state.contacts.filter(function (c) {
      if (state.tag && c.tags.indexOf(state.tag) < 0) return false;
      if (!q) return true;
      return util.norm(c.name + ' ' + c.phone + ' ' + (c.company || '') + ' ' + (c.email || '') + ' ' + (c.city || '')).indexOf(q) >= 0;
    });

    const val = function (c) {
      switch (state.sort) {
        case 'name': return util.norm(c.name);
        case 'value': return util.sum(store.dealsOf(c.id), function (d) { return d.value; });
        case 'created': return c.createdAt;
        default: return c.lastSeen || c.createdAt;
      }
    };
    list.sort(function (a, b) {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * state.dir;
      if (va > vb) return 1 * state.dir;
      return 0;
    });
    return list;
  }

  function selectedIds() { return Object.keys(state.selected).filter(function (k) { return state.selected[k]; }); }

  /* -------------------------------------------------------------- render */
  function render() {
    const all = rows();
    const shown = all.slice(0, state.page * state.perPage);
    const sel = selectedIds();

    root.innerHTML =
      '<div class="stack" style="min-height:0;flex:1">' +

      '<div class="row-gap" style="padding:12px 16px;gap:9px;border-bottom:1px solid var(--line);flex-wrap:wrap">' +
      '<div class="input-icon" style="width:280px;max-width:100%">' + icon('search', 15) +
      '<input class="input" id="ct-q" placeholder="Buscar por nombre, teléfono, empresa…" value="' + esc(state.q) + '" autocomplete="off"></div>' +
      '<select class="select" id="ct-tag" style="width:auto;min-width:150px">' +
      '<option value="">Todas las etiquetas</option>' +
      store.state.tags.map(function (t) {
        return '<option value="' + t.id + '"' + (state.tag === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
      }).join('') + '</select>' +
      '<span class="t-sm faint">' + util.num(all.length) + ' contacto' + (all.length === 1 ? '' : 's') + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-outline" data-act="import">' + icon('upload', 14) + 'Importar</button>' +
      '<button class="btn btn-sm btn-outline" data-act="export">' + icon('download', 14) + 'Exportar</button>' +
      '<button class="btn btn-sm btn-primary" data-act="new">' + icon('plus', 14) + 'Nuevo contacto</button>' +
      '</div>' +

      (sel.length ? '<div class="row-gap" style="padding:9px 16px;gap:8px;background:var(--accent-soft);border-bottom:1px solid var(--accent-line)">' +
        '<span class="t-sm strong">' + sel.length + ' seleccionado' + (sel.length === 1 ? '' : 's') + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm btn-outline" data-act="bulk-tag">' + icon('tag', 13) + 'Etiquetar</button>' +
        '<button class="btn btn-sm btn-outline" data-act="bulk-campaign">' + icon('megaphone', 13) + 'Crear campaña</button>' +
        '<button class="btn btn-sm btn-outline" data-act="bulk-export">' + icon('download', 13) + 'Exportar</button>' +
        '<button class="btn btn-sm btn-danger" data-act="bulk-delete">' + icon('trash', 13) + 'Eliminar</button>' +
        '<button class="btn btn-sm btn-ghost" data-act="bulk-clear">' + icon('x', 13) + '</button>' +
        '</div>' : '') +

      '<div class="table-wrap scroll" style="flex:1" id="ct-body"></div>' +
      '</div>';

    bodyEl = root.querySelector('#ct-body');

    if (!all.length) {
      bodyEl.innerHTML = ui.empty('users', 'Sin contactos',
        state.q ? 'No hay resultados para esa búsqueda.' : 'Importá tu agenda o creá el primer contacto.',
        '<button class="btn btn-primary" data-act="new">' + icon('plus', 15) + 'Nuevo contacto</button>');
    } else {
      bodyEl.innerHTML = tableHTML(shown, all.length);
    }
    wire();
  }

  function th(key, label, extra) {
    const on = state.sort === key;
    return '<th class="sortable' + (extra || '') + '" data-sort="' + key + '">' + esc(label) +
      (on ? ' ' + (state.dir < 0 ? '↓' : '↑') : '') + '</th>';
  }

  function tableHTML(list, total) {
    const allSel = list.length && list.every(function (c) { return state.selected[c.id]; });
    return '<table class="table"><thead><tr>' +
      '<th class="shrink"><button class="check" role="checkbox" aria-checked="' + (allSel ? 'true' : 'false') +
      '" data-act="sel-all">' + icon('check', 12) + '</button></th>' +
      th('name', 'Contacto') +
      '<th>Teléfono</th>' +
      '<th>Etiquetas</th>' +
      th('value', 'Valor', ' num') +
      th('recent', 'Último contacto', ' num') +
      '<th class="shrink"></th>' +
      '</tr></thead><tbody>' +
      list.map(rowHTML).join('') +
      '</tbody></table>' +
      (list.length < total ?
        '<div style="padding:14px;display:flex;justify-content:center">' +
        '<button class="btn btn-outline" data-act="more">Mostrar ' +
        Math.min(state.perPage, total - list.length) + ' más de ' + util.num(total) + '</button></div>' : '');
  }

  function rowHTML(c) {
    const deals = store.dealsOf(c.id);
    const valor = util.sum(deals.filter(function (d) {
      const s = store.stage(d.stageId); return !s || s.kind !== 'lost';
    }), function (d) { return d.value; });
    const tags = c.tags.map(store.tag.bind(store)).filter(Boolean);
    const conv = store.convOf(c.id);

    return '<tr data-id="' + c.id + '" aria-selected="' + (!!state.selected[c.id]) + '">' +
      '<td class="shrink"><button class="check" role="checkbox" aria-checked="' + (state.selected[c.id] ? 'true' : 'false') +
      '" data-act="sel" data-id="' + c.id + '">' + icon('check', 12) + '</button></td>' +
      '<td><div class="row-gap" style="gap:10px;min-width:0;cursor:pointer" data-act="open" data-id="' + c.id + '">' +
      ui.avatarHTML(c.name, { size: 'sm', seed: c.id }) +
      '<div class="stack" style="min-width:0;gap:0">' +
      '<span class="strong truncate">' + esc(c.name) + '</span>' +
      '<span class="t-xs faint truncate">' + esc(c.company || c.city || c.email || '—') + '</span>' +
      '</div></div></td>' +
      '<td class="t-num t-sm" style="white-space:nowrap">' + esc(util.phone(c.phone)) + '</td>' +
      '<td><div class="pills">' + (tags.length ? tags.slice(0, 3).map(function (t) { return ui.tagHTML(t); }).join('') +
        (tags.length > 3 ? '<span class="chip">+' + (tags.length - 3) + '</span>' : '') : '<span class="t-xs faint">—</span>') + '</div></td>' +
      '<td class="num">' + (valor ? esc(util.moneyCompact(valor)) : '<span class="faint">—</span>') + '</td>' +
      '<td class="num t-sm faint">' + esc(util.fmtStamp(c.lastSeen || c.createdAt)) + '</td>' +
      '<td class="shrink"><div class="row-gap" style="gap:2px">' +
      (conv ? '<button class="btn btn-ghost btn-icon btn-sm" data-act="chat" data-id="' + c.id + '" title="Abrir conversación">' + icon('inbox', 15) + '</button>' :
        '<button class="btn btn-ghost btn-icon btn-sm" data-act="chat" data-id="' + c.id + '" title="Iniciar conversación">' + icon('send', 15) + '</button>') +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="row-menu" data-id="' + c.id + '">' + icon('more', 15) + '</button>' +
      '</div></td>' +
      '</tr>';
  }

  /* -------------------------------------------------------------- eventos */
  /* Los campos se recrean en cada dibujado: se enlazan ahí. */
  function wire() {
    const q = root.querySelector('#ct-q');
    if (q) q.addEventListener('input', util.debounce(function () {
      state.q = q.value; state.page = 1;
      const pos = q.selectionStart;
      render();
      const n = root.querySelector('#ct-q'); n.focus(); n.setSelectionRange(pos, pos);
    }, 200));

    const tagSel = root.querySelector('#ct-tag');
    if (tagSel) tagSel.addEventListener('change', function () { state.tag = tagSel.value; state.page = 1; render(); });
  }

  /* La delegación se registra una sola vez, al montar la vista. */
  function wireOnce() {
    dom.on(root, 'click', '[data-sort]', function () {
      const k = this.dataset.sort;
      if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      render();
    });
    dom.on(root, 'click', '[data-act="more"]', function () { state.page++; render(); });
    dom.on(root, 'click', '[data-act="new"]', function () { editContact(null, render); });
    dom.on(root, 'click', '[data-act="import"]', importDialog);
    dom.on(root, 'click', '[data-act="export"]', function () { exportContacts(rows()); });

    dom.on(root, 'click', '[data-act="sel"]', function (e) {
      e.stopPropagation();
      const id = this.dataset.id;
      state.selected[id] = !state.selected[id];
      render();
    });
    dom.on(root, 'click', '[data-act="sel-all"]', function () {
      const list = rows().slice(0, state.page * state.perPage);
      const allSel = list.every(function (c) { return state.selected[c.id]; });
      list.forEach(function (c) { state.selected[c.id] = !allSel; });
      render();
    });
    dom.on(root, 'click', '[data-act="bulk-clear"]', function () { state.selected = {}; render(); });
    dom.on(root, 'click', '[data-act="bulk-tag"]', function () { bulkTag(this); });
    dom.on(root, 'click', '[data-act="bulk-export"]', function () {
      exportContacts(selectedIds().map(store.contact.bind(store)).filter(Boolean));
    });
    dom.on(root, 'click', '[data-act="bulk-campaign"]', function () {
      NS.campaigns.newFromContacts(selectedIds());
    });
    dom.on(root, 'click', '[data-act="bulk-delete"]', function () {
      const ids = selectedIds();
      ui.confirm({
        title: 'Eliminar contactos', danger: true, confirmText: 'Eliminar ' + ids.length,
        message: 'Se eliminarán ' + ids.length + ' contactos junto con sus conversaciones y negocios. No se puede deshacer.'
      }).then(function (ok) {
        if (!ok) return;
        store.commit(function (s) {
          s.contacts = s.contacts.filter(function (c) { return ids.indexOf(c.id) < 0; });
          s.conversations = s.conversations.filter(function (c) { return ids.indexOf(c.contactId) < 0; });
          s.deals = s.deals.filter(function (d) { return ids.indexOf(d.contactId) < 0; });
          s.tasks = s.tasks.filter(function (t) { return ids.indexOf(t.contactId) < 0; });
        }, 'contact');
        state.selected = {};
        render();
        ui.toast(ids.length + ' contactos eliminados', 'ok');
      });
    });

    dom.on(root, 'click', '[data-act="open"]', function () { openContact(this.dataset.id); });
    dom.on(root, 'click', '[data-act="chat"]', function (e) {
      e.stopPropagation();
      const c = store.contact(this.dataset.id);
      const r = wa.ensureConversation(c.id, 'Conversación');
      if (r.created) store.commit(null, 'conv');
      NS.app.go('bandeja', { conv: r.conv.id });
    });
    dom.on(root, 'click', '[data-act="row-menu"]', function (e) {
      e.stopPropagation();
      rowMenu(store.contact(this.dataset.id), this);
    });
  }

  function bulkTag(anchor) {
    const ids = selectedIds();
    ui.menu(anchor, [{ group: 'Aplicar etiqueta' }].concat(store.state.tags.map(function (t) {
      return {
        icon: 'tag', label: t.name, onClick: function () {
          store.commit(function () {
            ids.forEach(function (id) {
              const c = store.contact(id);
              if (c && c.tags.indexOf(t.id) < 0) c.tags.push(t.id);
            });
          }, 'contact');
          ui.toast('Etiqueta aplicada a ' + ids.length + ' contactos', 'ok');
          render();
        }
      };
    })).concat([{ sep: true }, { group: 'Quitar etiqueta' }]).concat(store.state.tags.map(function (t) {
      return {
        icon: 'x', label: t.name, onClick: function () {
          store.commit(function () {
            ids.forEach(function (id) {
              const c = store.contact(id);
              if (!c) return;
              const i = c.tags.indexOf(t.id);
              if (i >= 0) c.tags.splice(i, 1);
            });
          }, 'contact');
          render();
        }
      };
    })));
  }

  function rowMenu(c, anchor) {
    ui.menu(anchor, [
      { icon: 'eye', label: 'Ver ficha', onClick: function () { openContact(c.id); } },
      { icon: 'edit', label: 'Editar', onClick: function () { editContact(c.id, render); } },
      { icon: 'whatsapp', label: 'Abrir en WhatsApp', onClick: function () { window.open(wa.waLink(c.phone, ''), '_blank', 'noopener'); } },
      { icon: 'funnel', label: 'Nuevo negocio', onClick: function () { NS.pipeline.newDeal(c.id, render); } },
      { sep: true },
      {
        icon: c.optIn ? 'x' : 'check', label: c.optIn ? 'Marcar sin consentimiento' : 'Marcar con consentimiento',
        onClick: function () { store.commit(function () { c.optIn = !c.optIn; }, 'contact'); render(); }
      },
      {
        icon: 'shield', label: c.blocked ? 'Desbloquear' : 'Bloquear',
        onClick: function () { store.commit(function () { c.blocked = !c.blocked; }, 'contact'); render(); }
      },
      { sep: true },
      {
        icon: 'trash', label: 'Eliminar contacto', variant: 'danger', onClick: function () {
          ui.confirm({ title: 'Eliminar contacto', message: 'Se elimina ' + c.name + ' con su historial.', danger: true, confirmText: 'Eliminar' })
            .then(function (ok) {
              if (!ok) return;
              store.commit(function (s) {
                s.contacts = s.contacts.filter(function (x) { return x.id !== c.id; });
                s.conversations = s.conversations.filter(function (x) { return x.contactId !== c.id; });
                s.deals = s.deals.filter(function (d) { return d.contactId !== c.id; });
              }, 'contact');
              render();
            });
        }
      }
    ], { align: 'right' });
  }

  /* --------------------------------------------------------- ficha 360 */
  function openContact(id) {
    const c = store.contact(id);
    if (!c) return;
    const deals = store.dealsOf(c.id);
    const tasks = store.tasksOf(c.id);
    const convs = store.state.conversations.filter(function (x) { return x.contactId === c.id; });
    const mensajes = util.sum(convs, function (x) { return x.messages.length; });
    const valorGanado = util.sum(deals.filter(function (d) {
      const s = store.stage(d.stageId); return s && s.kind === 'won';
    }), function (d) { return d.value; });

    const body = el('div', { class: 'stack', style: { gap: '16px' } });
    body.innerHTML =
      '<div class="row-gap" style="gap:14px">' + ui.avatarHTML(c.name, { size: 'lg', seed: c.id }) +
      '<div class="stack" style="gap:2px;min-width:0">' +
      '<div class="t-lg truncate">' + esc(c.name) + '</div>' +
      '<div class="t-sm faint">' + esc(util.phone(c.phone)) + (c.company ? ' · ' + esc(c.company) : '') + '</div>' +
      '</div></div>' +

      '<div class="pills">' + c.tags.map(store.tag.bind(store)).filter(Boolean)
        .map(function (t) { return ui.tagHTML(t); }).join('') + '</div>' +

      '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">' +
      kpiMini('Conversaciones', util.num(convs.length)) +
      kpiMini('Mensajes', util.num(mensajes)) +
      kpiMini('Ganado', util.moneyCompact(valorGanado)) +
      '</div>' +

      '<div class="card"><div class="card-head"><span class="t-md">Datos</span></div>' +
      '<div class="card-pad"><dl class="kv">' +
      '<dt>Teléfono</dt><dd>' + esc(util.phone(c.phone)) + '</dd>' +
      '<dt>Email</dt><dd>' + esc(c.email || '—') + '</dd>' +
      '<dt>Empresa</dt><dd>' + esc(c.company || '—') + '</dd>' +
      '<dt>Ciudad</dt><dd>' + esc(c.city || '—') + '</dd>' +
      '<dt>Origen</dt><dd>' + esc(c.source || '—') + '</dd>' +
      '<dt>Alta</dt><dd>' + esc(util.fmtDate(c.createdAt)) + '</dd>' +
      '<dt>Promociones</dt><dd>' + (c.optIn ? 'Acepta recibir' : 'No acepta') + '</dd>' +
      Object.keys(c.custom || {}).map(function (k) { return '<dt>' + esc(k) + '</dt><dd>' + esc(c.custom[k]) + '</dd>'; }).join('') +
      '</dl></div></div>' +

      (deals.length ? '<div class="card"><div class="card-head"><span class="t-md">Negocios</span></div>' +
        '<div class="stack">' + deals.map(function (d) {
          const s = store.stage(d.stageId);
          return '<div class="mini-item" style="margin:4px 8px"><div class="stack" style="gap:3px;flex:1;min-width:0">' +
            '<span class="t-sm strong truncate">' + esc(d.title) + '</span>' +
            '<span class="row-gap"><span class="chip" data-color="' + esc(s ? s.color : 'neutral') + '">' + esc(s ? s.name : '—') + '</span>' +
            '<span class="t-xs t-num faint">' + esc(util.money(d.value, d.currency)) + '</span></span></div></div>';
        }).join('') + '</div></div>' : '') +

      (tasks.length ? '<div class="card"><div class="card-head"><span class="t-md">Tareas</span></div>' +
        '<div class="stack">' + tasks.map(function (t) {
          return '<div class="mini-item" style="margin:4px 8px;cursor:default">' +
            '<span class="' + (t.done ? 'accent' : 'faint') + '">' + icon(t.done ? 'check' : 'clock', 14) + '</span>' +
            '<div class="stack" style="gap:1px;min-width:0"><span class="t-sm truncate' + (t.done ? ' faint' : '') + '">' + esc(t.title) + '</span>' +
            '<span class="t-xs faint">' + esc(util.fmtDate(t.dueAt)) + '</span></div></div>';
        }).join('') + '</div></div>' : '') +

      ((c.notes || []).length ? '<div class="card"><div class="card-head"><span class="t-md">Notas</span></div>' +
        '<div class="card-pad stack" style="gap:10px">' + c.notes.slice().reverse().map(function (n) {
          return '<div class="stack" style="gap:2px"><span class="t-sm">' + esc(n.text) + '</span>' +
            '<span class="t-xs faint">' + esc(util.relTime(n.at)) + '</span></div>';
        }).join('') + '</div></div>' : '');

    const drawer = ui.drawer({
      title: c.name, subtitle: util.phone(c.phone), body: body,
      footer: '<button class="btn btn-outline" data-act="edit">' + icon('edit', 14) + 'Editar</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary" data-act="chat">' + icon('whatsapp', 14) + 'Conversar</button>'
    });

    dom.on(drawer.root, 'click', '[data-act="edit"]', function () {
      drawer.close();
      editContact(c.id, function () { render(); openContact(c.id); });
    });
    dom.on(drawer.root, 'click', '[data-act="chat"]', function () {
      drawer.close();
      const r = wa.ensureConversation(c.id, 'Conversación');
      if (r.created) store.commit(null, 'conv');
      NS.app.go('bandeja', { conv: r.conv.id });
    });
  }

  function kpiMini(label, value) {
    return '<div class="kpi" style="padding:11px 12px"><div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value" style="font-size:22px">' + esc(value) + '</div></div>';
  }

  /* ------------------------------------------------------- alta / edición */
  function editContact(id, done) {
    const c = id ? store.contact(id) : null;
    ui.form({
      title: c ? 'Editar contacto' : 'Nuevo contacto',
      icon: 'users', submitText: c ? 'Guardar' : 'Crear contacto',
      fields: [
        { key: 'name', label: 'Nombre y apellido', required: true, value: c ? c.name : '' },
        { key: 'phone', label: 'Teléfono con código de país', required: true, value: c ? c.phone : '54911', hint: 'Sólo números. Ejemplo: 5491133445566' },
        { key: 'email', label: 'Email', type: 'email', value: c ? c.email : '' },
        { key: 'company', label: 'Empresa', value: c ? c.company : '' },
        { key: 'city', label: 'Ciudad', value: c ? c.city : '' },
        {
          key: 'source', label: 'Origen', type: 'select', value: c ? c.source : 'WhatsApp directo',
          options: ['WhatsApp directo', 'Instagram', 'Sitio web', 'Recomendación', 'Google', 'Feria', 'Marketplace', 'Otro']
            .map(function (o) { return { value: o, label: o }; })
        },
        { key: 'optIn', label: 'Acepta recibir promociones', type: 'switch', value: c ? c.optIn : true }
      ]
    }).then(function (r) {
      if (!r) return;
      const phone = util.phoneRaw(r.phone);
      if (phone.length < 8) { ui.toast('El teléfono parece incompleto', 'warn'); return; }
      const dup = wa.findContactByPhone(phone);
      if (dup && (!c || dup.id !== c.id)) { ui.toast('Ya existe un contacto con ese número: ' + dup.name, 'warn'); return; }

      store.commit(function (s) {
        if (c) Object.assign(c, r, { phone: phone });
        else s.contacts.unshift({
          id: util.uid('ct'), name: r.name, phone: phone, email: r.email, company: r.company,
          city: r.city, source: r.source, optIn: r.optIn, tags: [], custom: {},
          createdAt: Date.now(), lastSeen: Date.now(), notes: [], blocked: false
        });
      }, 'contact');
      ui.toast(c ? 'Contacto actualizado' : 'Contacto creado', 'ok');
      done && done();
    });
  }

  /* ---------------------------------------------------- importar / exportar */
  function exportContacts(list) {
    const data = list.map(function (c) {
      return {
        nombre: c.name, telefono: c.phone, email: c.email || '', empresa: c.company || '',
        ciudad: c.city || '', origen: c.source || '',
        etiquetas: c.tags.map(function (t) { const x = store.tag(t); return x ? x.name : ''; }).filter(Boolean).join('|'),
        promociones: c.optIn ? 'si' : 'no',
        alta: util.fmtDate(c.createdAt)
      };
    });
    util.download('contactos-' + new Date().toISOString().slice(0, 10) + '.csv', util.toCSV(data), 'text/csv;charset=utf-8');
    ui.toast('Exportados ' + data.length + ' contactos', 'ok');
  }

  function importDialog() {
    const wrap = el('div', { class: 'stack', style: { gap: '14px' } });
    wrap.innerHTML =
      '<div class="callout" data-kind="info">' + icon('info', 16) +
      '<div>El archivo debe tener una fila de encabezados. Reconocemos <b>nombre</b>, <b>telefono</b>, ' +
      '<b>email</b>, <b>empresa</b>, <b>ciudad</b>, <b>origen</b> y <b>etiquetas</b> (separadas por |). ' +
      'Los números repetidos se actualizan en lugar de duplicarse.</div></div>' +
      '<input type="file" id="imp-file" class="input" accept=".csv,text/csv" style="padding-top:6px">' +
      '<div id="imp-preview"></div>';

    let parsed = null;
    const modal = ui.modal({
      title: 'Importar contactos', icon: 'upload', size: 'wide', body: wrap,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Importar', variant: 'primary', keepOpen: true, onClick: function (api) {
            if (!parsed || !parsed.length) { ui.toast('Elegí un archivo CSV válido', 'warn'); return false; }
            const res = applyImport(parsed);
            api.close();
            ui.toast('Importados ' + res.creados + ' nuevos y actualizados ' + res.actualizados, 'ok');
            ui.sound('done');
            render();
          }
        }
      ]
    });

    wrap.querySelector('#imp-file').addEventListener('change', function () {
      const f = this.files && this.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = function () {
        try {
          parsed = util.parseCSV(fr.result);
          const prev = wrap.querySelector('#imp-preview');
          if (!parsed.length) { prev.innerHTML = '<div class="callout" data-kind="warn">' + icon('warn', 16) + 'El archivo no tiene filas.</div>'; return; }
          const cols = Object.keys(parsed[0]);
          prev.innerHTML = '<div class="t-sm strong" style="margin-bottom:8px">' + parsed.length + ' filas detectadas</div>' +
            NS.chart.dataTable(cols, parsed.slice(0, 6).map(function (r) { return cols.map(function (c) { return r[c]; }); }));
        } catch (e) {
          wrap.querySelector('#imp-preview').innerHTML = '<div class="callout" data-kind="warn">' + icon('warn', 16) + 'No se pudo leer el archivo.</div>';
        }
      };
      fr.readAsText(f, 'utf-8');
    });
  }

  function applyImport(filas) {
    let creados = 0, actualizados = 0;
    const key = function (row, names) {
      for (let i = 0; i < names.length; i++) {
        const k = Object.keys(row).find(function (x) { return util.norm(x) === names[i]; });
        if (k && row[k]) return row[k];
      }
      return '';
    };

    store.commit(function (s) {
      filas.forEach(function (row) {
        const phone = util.phoneRaw(key(row, ['telefono', 'phone', 'celular', 'whatsapp', 'movil']));
        if (phone.length < 8) return;
        const nombre = key(row, ['nombre', 'name', 'contacto', 'cliente']) || util.phone(phone);
        const etiquetas = key(row, ['etiquetas', 'tags']).split('|').map(function (t) { return t.trim(); }).filter(Boolean);
        const tagIds = etiquetas.map(function (nm) {
          let t = s.tags.find(function (x) { return util.norm(x.name) === util.norm(nm); });
          if (!t) { t = { id: util.uid('tag'), name: nm, color: 'neutral' }; s.tags.push(t); }
          return t.id;
        });

        const existente = s.contacts.find(function (c) { return util.phoneRaw(c.phone) === phone; });
        if (existente) {
          existente.name = nombre || existente.name;
          existente.email = key(row, ['email', 'correo']) || existente.email;
          existente.company = key(row, ['empresa', 'company', 'negocio']) || existente.company;
          existente.city = key(row, ['ciudad', 'city', 'localidad']) || existente.city;
          tagIds.forEach(function (t) { if (existente.tags.indexOf(t) < 0) existente.tags.push(t); });
          actualizados++;
        } else {
          s.contacts.unshift({
            id: util.uid('ct'), name: nombre, phone: phone,
            email: key(row, ['email', 'correo']), company: key(row, ['empresa', 'company', 'negocio']),
            city: key(row, ['ciudad', 'city', 'localidad']), source: key(row, ['origen', 'source']) || 'Importado',
            tags: tagIds, custom: {}, optIn: util.norm(key(row, ['promociones', 'optin'])) !== 'no',
            createdAt: Date.now(), lastSeen: Date.now(), notes: [], blocked: false
          });
          creados++;
        }
      });
      store.log('contact', 'importó ' + (creados + actualizados) + ' contactos desde CSV');
    }, 'contact');

    return { creados: creados, actualizados: actualizados };
  }

  /* --------------------------------------------------------------- vista */
  NS.views = NS.views || {};
  NS.views.contactos = {
    title: 'Contactos',
    icon: 'users',
    mount: function (container) {
      root = container;
      root.className = 'view stack';
      state.selected = {};
      wireOnce();
      render();
      const off = store.on('contact', render);
      return { destroy: off };
    }
  };

  NS.contacts = { editContact: editContact, open: openContact, exportContacts: exportContacts };

})(window.CRM);
