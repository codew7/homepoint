/* =========================================================================
   Nexo CRM · bandeja de entrada
   Tres paneles: lista de conversaciones, hilo y ficha del contacto.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui, wa = NS.wa;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  const EMOJIS = ['😊', '😁', '😂', '🥰', '😍', '🤝', '👍', '🙌', '🙏', '👌', '💪', '🎉', '✨', '🔥', '💚', '❤️',
    '😅', '😉', '🤗', '🤔', '😌', '😎', '🥳', '📦', '🚚', '💳', '🧾', '📍', '📅', '⏰', '✅', '❌',
    '⚠️', '💬', '📞', '📲', '🛒', '🏷️', '💰', '🎁', '⭐', '👏', '🫶', '☀️', '🌊', '🍀', '🚀', '👋'];

  const state = {
    selected: null,
    filter: 'all',
    search: '',
    tagFilter: '',
    agentFilter: '',
    composerMode: 'reply',
    panel: true,
    mobile: 'list'
  };

  let root, listEl, threadEl, ctxEl, inboxEl, unsub = [], scrollLock = false;

  /* ------------------------------------------------------------ filtrado */
  function visibleConversations() {
    const st = store.state, me = store.me();
    const q = util.norm(state.search);
    return st.conversations.filter(function (c) {
      const contact = store.contact(c.contactId);
      if (!contact) return false;

      if (state.filter === 'mine' && c.assignedTo !== (me || {}).id) return false;
      if (state.filter === 'unassigned' && c.assignedTo) return false;
      if (state.filter === 'unread' && !c.unread) return false;
      if (state.filter === 'pending' && c.status !== 'pending') return false;
      if (state.filter === 'closed' && c.status !== 'closed') return false;
      if (state.filter !== 'closed' && state.filter !== 'all' && c.status === 'closed') return false;
      if (state.filter === 'all' && c.status === 'closed') return false;

      if (state.tagFilter && c.tags.indexOf(state.tagFilter) < 0 && contact.tags.indexOf(state.tagFilter) < 0) return false;
      if (state.agentFilter && c.assignedTo !== state.agentFilter) return false;

      if (q) {
        const last = store.lastMessage(c);
        const hay = util.norm(contact.name + ' ' + contact.phone + ' ' + (contact.company || '') + ' ' +
          (c.subject || '') + ' ' + (last ? last.body : ''));
        if (hay.indexOf(q) < 0) {
          /* búsqueda profunda en el historial completo del hilo */
          if (!c.messages.some(function (m) { return util.norm(m.body).indexOf(q) >= 0; })) return false;
        }
      }
      return true;
    }).sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (store.state.settings.inboxSort === 'unread' && (!!a.unread !== !!b.unread)) return a.unread ? -1 : 1;
      return b.lastMessageAt - a.lastMessageAt;
    });
  }

  function counts() {
    const st = store.state, me = store.me();
    const abiertas = st.conversations.filter(function (c) { return c.status !== 'closed'; });
    return {
      all: abiertas.length,
      mine: abiertas.filter(function (c) { return c.assignedTo === (me || {}).id; }).length,
      unassigned: abiertas.filter(function (c) { return !c.assignedTo; }).length,
      unread: abiertas.filter(function (c) { return c.unread; }).length,
      pending: st.conversations.filter(function (c) { return c.status === 'pending'; }).length,
      closed: st.conversations.filter(function (c) { return c.status === 'closed'; }).length
    };
  }

  /* --------------------------------------------------------------- lista */
  function renderList() {
    const convs = visibleConversations();
    const c = counts();

    const filtros = [
      { k: 'all', label: 'Todas', n: c.all },
      { k: 'unread', label: 'Sin leer', n: c.unread },
      { k: 'mine', label: 'Míos', n: c.mine },
      { k: 'unassigned', label: 'Sin asignar', n: c.unassigned },
      { k: 'pending', label: 'En espera', n: c.pending },
      { k: 'closed', label: 'Cerradas', n: c.closed }
    ];

    listEl.innerHTML =
      '<div class="conv-list-head">' +
      '<div class="input-icon">' + icon('search', 15) +
      '<input class="input" id="inbox-search" placeholder="Buscar en conversaciones…" value="' + esc(state.search) + '" autocomplete="off">' +
      '</div>' +
      '<div class="pills" style="overflow-x:auto;padding-bottom:2px">' +
      filtros.map(function (f) {
        return '<button class="pill" data-filter="' + f.k + '" aria-pressed="' + (state.filter === f.k) + '">' +
          esc(f.label) + (f.n ? ' <span class="pill-n">' + f.n + '</span>' : '') + '</button>';
      }).join('') +
      '</div>' +
      (state.tagFilter || state.agentFilter ?
        '<div class="row-gap"><span class="t-xs faint">Filtros activos</span>' +
        '<button class="btn btn-ghost btn-sm" data-act="clear-filters">Limpiar</button></div>' : '') +
      '</div>' +
      '<div class="scroll" id="conv-scroll" style="flex:1"></div>';

    const scroll = listEl.querySelector('#conv-scroll');

    if (!convs.length) {
      scroll.innerHTML = ui.empty('inbox', 'Sin conversaciones',
        state.search ? 'No hay resultados para “' + state.search + '”.' : 'Cuando llegue un mensaje aparecerá acá.');
    } else {
      scroll.innerHTML = convs.map(convItemHTML).join('');
    }

    /* el campo se recrea en cada dibujado, por eso se enlaza acá */
    const input = listEl.querySelector('#inbox-search');
    input.addEventListener('input', util.debounce(function () {
      state.search = input.value;
      const pos = input.selectionStart;
      renderList();
      const ni = listEl.querySelector('#inbox-search');
      ni.focus(); ni.setSelectionRange(pos, pos);
    }, 180));
  }

  /* referencias vivas: los escuchas delegados nunca capturan una
     conversación vieja */
  function curConv() { return state.selected ? store.conversation(state.selected) : null; }
  function curContact() { const c = curConv(); return c ? store.contact(c.contactId) : null; }
  function curComposer() { return threadEl.querySelector('#composer'); }

  function convItemHTML(c) {
    const contact = store.contact(c.contactId);
    const last = store.lastMessage(c);
    const agent = c.assignedTo ? store.agent(c.assignedTo) : null;
    const tags = (c.tags || []).map(store.tag.bind(store)).filter(Boolean).slice(0, 2);
    const prefix = last ? (last.dir === 'out' ? (last.status === 'read' ? '✓✓ ' : '✓ ') : last.dir === 'note' ? '📝 ' : '') : '';

    return '<div class="conv-item' + (c.unread ? ' is-unread' : '') + '" data-id="' + c.id + '" ' +
      'aria-selected="' + (state.selected === c.id) + '" tabindex="0">' +
      ui.avatarHTML(contact.name, { seed: contact.id }) +
      '<div class="stack" style="min-width:0">' +
      '<div class="conv-top">' +
      '<span class="conv-name truncate">' + esc(contact.name) + '</span>' +
      '<span class="conv-time">' + esc(util.fmtStamp(c.lastMessageAt)) + '</span>' +
      '</div>' +
      '<div class="conv-preview truncate">' + esc(prefix) + esc(last ? util.truncate(last.body, 64) : 'Sin mensajes') + '</div>' +
      '<div class="conv-meta">' +
      '<i class="status-dot" data-s="' + c.status + '" title="' + statusLabel(c.status) + '"></i>' +
      tags.map(function (t) { return ui.tagHTML(t); }).join('') +
      (c.pinned ? '<span class="faint" title="Fijada">' + icon('pin', 12) + '</span>' : '') +
      '<span class="spacer"></span>' +
      (agent ? '<span class="t-xs faint truncate" title="' + esc(agent.name) + '">' + esc(util.initials(agent.name)) + '</span>' :
        '<span class="chip" data-color="amber">Sin asignar</span>') +
      (c.unread ? '<span class="unread-badge">' + c.unread + '</span>' : '') +
      '</div>' +
      '</div>' +
      '</div>';
  }

  function statusLabel(s) {
    return { open: 'Abierta', pending: 'En espera', closed: 'Cerrada' }[s] || s;
  }

  /* --------------------------------------------------------------- hilo */
  function openConversation(id) {
    const conv = store.conversation(id);
    if (!conv) return;
    state.selected = id;
    state.mobile = 'thread';
    if (conv.unread) {
      store.commit(function () { conv.unread = 0; }, 'read');
    }
    renderList();
    renderThread();
    renderCtx();
    syncMobile();
  }

  function renderThread() {
    const conv = state.selected ? store.conversation(state.selected) : null;

    if (!conv) {
      threadEl.innerHTML = ui.empty('inboxOpen', 'Elegí una conversación',
        'Seleccioná un chat de la izquierda para ver el historial completo y responder.');
      return;
    }

    const contact = store.contact(conv.contactId);
    const agent = conv.assignedTo ? store.agent(conv.assignedTo) : null;

    threadEl.innerHTML =
      '<div class="thread-head">' +
      '<button class="btn btn-ghost btn-icon btn-sm hide-desktop" data-act="back" aria-label="Volver">' + icon('arrowLeft', 17) + '</button>' +
      ui.avatarHTML(contact.name, { seed: contact.id }) +
      '<div class="stack" style="min-width:0;gap:0">' +
      '<div class="row-gap" style="min-width:0">' +
      '<span class="t-md truncate">' + esc(contact.name) + '</span>' +
      (contact.company ? '<span class="chip" data-color="neutral">' + esc(contact.company) + '</span>' : '') +
      '</div>' +
      '<span class="t-xs faint truncate">' + esc(util.phone(contact.phone)) +
      ' · último mensaje ' + esc(util.relTime(conv.lastMessageAt)) + '</span>' +
      '</div>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-sm btn-outline" data-act="assign" title="Asignar responsable">' +
      (agent ? ui.avatarHTML(agent.name, { size: 'sm', seed: agent.id }) + '<span class="truncate" style="max-width:90px">' + esc(agent.name.split(' ')[0]) + '</span>'
        : icon('handoff', 15) + 'Asignar') + '</button>' +
      '<button class="btn btn-sm btn-outline" data-act="status">' +
      '<i class="status-dot" data-s="' + conv.status + '"></i>' + statusLabel(conv.status) + '</button>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="snooze" title="Posponer">' + icon('snooze', 17) + '</button>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="panel" title="Ficha del contacto">' + icon('info', 17) + '</button>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="more" title="Más acciones">' + icon('more', 17) + '</button>' +
      '</div>' +
      '<div class="thread-body scroll" id="thread-body"></div>' +
      composerHTML(conv);

    renderMessages(conv);
    wireThread(conv);
  }

  function renderMessages(conv) {
    const body = threadEl.querySelector('#thread-body');
    if (!body) return;
    const wasBottom = true;
    let html = '';
    let lastDay = null;

    conv.messages.forEach(function (m, i) {
      const day = util.startOfDay(m.at).getTime();
      if (day !== lastDay) {
        html += '<div class="day-sep">' + esc(util.fmtDayLabel(m.at)) + '</div>';
        lastDay = day;
      }
      const prev = conv.messages[i - 1], next = conv.messages[i + 1];
      const grouped = prev && prev.dir === m.dir && (m.at - prev.at) < 240000 && m.dir !== 'note';
      const last = !next || next.dir !== m.dir || (next.at - m.at) >= 240000;
      html += messageHTML(m, grouped, last);
    });

    if (conv.snoozeUntil && conv.snoozeUntil > Date.now()) {
      html += '<div class="day-sep" style="color:var(--warn-fg)">Pospuesta hasta ' + esc(util.fmtDate(conv.snoozeUntil)) + ' ' + esc(util.fmtTime(conv.snoozeUntil)) + '</div>';
    }

    body.innerHTML = html;
    if (wasBottom) body.scrollTop = body.scrollHeight;
  }

  function messageHTML(m, grouped, last) {
    const cls = 'msg ' + m.dir + (grouped ? ' grouped' : '') + (last ? ' last' : '');

    if (m.dir === 'note') {
      const author = m.author ? store.agent(m.author) : null;
      return '<div class="' + cls + '" data-mid="' + m.id + '">' +
        '<div class="bubble">' +
        '<div class="note-tag">' + icon('note', 12) + 'Nota interna' + (author ? ' · ' + esc(author.name) : '') + '</div>' +
        util.waFormat(m.body) +
        '<div class="bubble-foot">' + esc(util.fmtTime(m.at)) + '</div>' +
        '</div></div>';
    }

    let contenido;
    if (m.type === 'doc' || m.type === 'image' || m.type === 'file') {
      contenido = '<div class="attach">' +
        '<span class="attach-mark">' + icon(m.type === 'image' ? 'image' : 'file', 17) + '</span>' +
        '<div class="stack" style="min-width:0;gap:1px">' +
        '<span class="t-sm strong truncate">' + esc(m.body.replace(/^\[|\]$/g, '')) + '</span>' +
        '<span class="t-xs" style="opacity:.7">' + esc(m.meta && m.meta.size ? m.meta.size : 'Archivo adjunto') + '</span>' +
        '</div></div>' + (m.meta && m.meta.dataUrl ?
          '<img src="' + esc(m.meta.dataUrl) + '" alt="" style="max-width:100%;border-radius:10px;margin-top:6px;display:block">' : '');
    } else {
      contenido = util.waFormat(m.body);
    }

    const tick = m.dir === 'out' ? statusTick(m) : '';
    const bot = m.meta && m.meta.bot ? '<span title="Enviado por una automatización">' + icon('bolt', 11) + '</span>' : '';
    const tpl = m.type === 'template' ? '<span title="Plantilla">' + icon('template', 11) + '</span>' : '';

    return '<div class="' + cls + '" data-mid="' + m.id + '">' +
      '<div class="bubble">' + contenido +
      '<div class="bubble-foot">' + bot + tpl + esc(util.fmtTime(m.at)) + tick + '</div>' +
      (m.status === 'failed' ? '<div class="t-xs" style="color:var(--danger);margin-top:3px">' +
        esc(m.error || 'No se pudo entregar') + ' · <button class="link" data-act="retry" data-mid="' + m.id + '">Reintentar</button></div>' : '') +
      '</div></div>';
  }

  function statusTick(m) {
    if (m.status === 'sending') return '<span title="Enviando">' + icon('clock', 11) + '</span>';
    if (m.status === 'failed') return '<span class="tick-failed" title="Falló">' + icon('warn', 11) + '</span>';
    if (m.status === 'read') return '<span class="tick-read" title="Leído">' + icon('checks', 12) + '</span>';
    if (m.status === 'delivered') return '<span title="Entregado">' + icon('checks', 12) + '</span>';
    return '<span title="Enviado">' + icon('check', 12) + '</span>';
  }

  /* ---------------------------------------------------------- redactor */
  function composerHTML(conv) {
    const st = store.state;
    const bloqueado = conv.status === 'closed';
    return '<div class="composer" data-mode="' + state.composerMode + '">' +
      '<div class="composer-tabs">' +
      '<button class="composer-tab" data-mode="reply" aria-selected="' + (state.composerMode === 'reply') + '">' + icon('whatsapp', 13) + ' Responder</button>' +
      '<button class="composer-tab" data-mode="note" aria-selected="' + (state.composerMode === 'note') + '">' + icon('note', 13) + ' Nota interna</button>' +
      '<span class="spacer"></span>' +
      (wa.mode() === 'link' ? '<span class="t-xs faint">' + icon('link', 12) + ' Se abrirá WhatsApp para enviar</span>' :
        wa.mode() === 'demo' ? '<span class="t-xs faint">Modo demostración</span>' : '') +
      '</div>' +
      '<div class="composer-box">' +
      '<textarea class="composer-input" id="composer" rows="1" placeholder="' +
      (state.composerMode === 'note' ? 'Escribí una nota que sólo verá tu equipo…' : 'Escribí un mensaje…  /  para respuestas rápidas') +
      '"' + (bloqueado ? ' disabled' : '') + '></textarea>' +
      '<div class="composer-actions">' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="emoji" title="Emojis">' + icon('smile', 17) + '</button>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="attach" title="Adjuntar">' + icon('paperclip', 17) + '</button>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="template" title="Plantillas">' + icon('template', 17) + '</button>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="quick" title="Respuestas rápidas">' + icon('bolt', 17) + '</button>' +
      '<button class="send-btn" data-act="send" disabled aria-label="Enviar">' + icon('send', 17) + '</button>' +
      '</div></div>' +
      (bloqueado ? '<div class="t-xs faint">Esta conversación está cerrada. Al responder se reabre automáticamente. ' +
        '<button class="link" data-act="reopen">Reabrir ahora</button></div>' :
        '<div class="t-xs faint">Enter envía · Shift+Enter salto de línea' +
        (st.settings.signature.enabled && st.settings.signature.text ? ' · firma activa' : '') + '</div>') +
      '<input type="file" id="file-input" class="hide" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv">' +
      '</div>';
  }

  /* Sólo los nodos recreados en cada dibujado se enlazan acá; toda la
     delegación vive en wireOnce(). */
  function wireThread(conv) {
    const composer = threadEl.querySelector('#composer');
    const sendBtn = threadEl.querySelector('[data-act="send"]');

    if (composer) {
      ui.autoGrow(composer);
      composer.addEventListener('input', function () {
        sendBtn.disabled = !composer.value.trim();
        maybeQuickReplies(composer, conv);
      });
      composer.addEventListener('keydown', function (e) {
        const menu = threadEl.querySelector('.qr-menu');
        if (menu) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); moveQR(menu, e.key === 'ArrowDown' ? 1 : -1); return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            const active = menu.querySelector('.qr-item.is-active');
            if (active) { e.preventDefault(); applyQuickReply(composer, active.dataset.id, conv); return; }
          }
          if (e.key === 'Escape') { menu.remove(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          doSend(conv, composer);
        }
      });
      setTimeout(function () { composer.focus(); }, 40);
    }

    const fileInput = threadEl.querySelector('#file-input');
    if (fileInput) fileInput.addEventListener('change', function () {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      attachFile(conv, f);
      fileInput.value = '';
    });

    /* pegar imagen directamente en el redactor */
    if (composer) composer.addEventListener('paste', function (e) {
      const items = (e.clipboardData || {}).items || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          const f = items[i].getAsFile();
          if (f) { e.preventDefault(); attachFile(conv, f); }
          return;
        }
      }
    });
  }

  function doSend(conv, composer) {
    const raw = (composer.value || '').trim();
    if (!raw) return;
    const st = store.state;
    let body = raw;

    if (state.composerMode === 'reply' && st.settings.signature.enabled && st.settings.signature.text) {
      body += '\n\n' + st.settings.signature.text;
    }

    composer.value = '';
    composer.style.height = 'auto';
    composer.dispatchEvent(new Event('input'));

    wa.send(conv, { type: state.composerMode === 'note' ? 'note' : 'text', body: body });
    if (state.composerMode === 'reply' && conv.status === 'pending') {
      store.commit(function () { conv.status = 'open'; }, 'conv');
    }
    composer.focus();
  }

  function attachFile(conv, file) {
    const size = file.size < 1024 * 1024
      ? Math.round(file.size / 1024) + ' KB'
      : (file.size / 1048576).toFixed(1) + ' MB';
    const esImagen = file.type.indexOf('image') === 0;

    const enviar = function (dataUrl) {
      wa.send(conv, {
        type: esImagen ? 'image' : 'doc',
        body: '[' + file.name + ']',
        meta: { size: size, dataUrl: dataUrl || null, mime: file.type }
      });
    };

    /* las imágenes chicas se guardan para poder verlas; las grandes sólo se
       referencian, para no llenar el almacenamiento del navegador */
    if (esImagen && file.size <= 220 * 1024) {
      const fr = new FileReader();
      fr.onload = function () { enviar(fr.result); };
      fr.readAsDataURL(file);
    } else {
      if (esImagen) ui.toast('Imagen grande: se adjunta la referencia, no la vista previa', 'info');
      enviar(null);
    }
  }

  /* ------------------------------------------------- respuestas rápidas */
  function maybeQuickReplies(composer, conv) {
    const val = composer.value;
    const existing = threadEl.querySelector('.qr-menu');
    const m = /(^|\n)\/(\S*)$/.exec(val);
    if (!m) { if (existing) existing.remove(); return; }
    const q = util.norm(m[2]);
    const list = store.state.quickReplies.filter(function (r) {
      return !q || util.norm(r.shortcut).indexOf(q) === 0 || util.norm(r.title).indexOf(q) >= 0;
    });
    if (!list.length) { if (existing) existing.remove(); return; }
    const html = list.map(function (r, i) {
      return '<div class="qr-item' + (i === 0 ? ' is-active' : '') + '" data-id="' + r.id + '">' +
        '<span class="qr-key">/' + esc(r.shortcut) + '</span>' +
        '<div class="stack" style="min-width:0;gap:1px">' +
        '<span class="t-sm strong">' + esc(r.title) + '</span>' +
        '<span class="t-xs faint clamp-2">' + esc(r.body) + '</span>' +
        '</div></div>';
    }).join('');
    if (existing) existing.innerHTML = html;
    else {
      const node = el('div', { class: 'qr-menu', html: html });
      threadEl.querySelector('.composer').appendChild(node);
    }
  }

  function moveQR(menu, dir) {
    const items = dom.$$('.qr-item', menu);
    let i = items.findIndex(function (n) { return n.classList.contains('is-active'); });
    items.forEach(function (n) { n.classList.remove('is-active'); });
    i = util.clamp(i + dir, 0, items.length - 1);
    items[i].classList.add('is-active');
    items[i].scrollIntoView({ block: 'nearest' });
  }

  function applyQuickReply(composer, id, conv) {
    const qr = store.state.quickReplies.find(function (r) { return r.id === id; });
    if (!qr) return;
    const contact = store.contact(conv.contactId);
    const body = util.interpolate(qr.body, {
      nombre: (contact.name || '').split(' ')[0],
      negocio: store.state.workspace.name,
      telefono: util.phone(contact.phone)
    });
    composer.value = composer.value.replace(/(^|\n)\/\S*$/, '$1') + body;
    const menu = threadEl.querySelector('.qr-menu');
    if (menu) menu.remove();
    composer.focus();
    composer.dispatchEvent(new Event('input'));
  }

  function quickReplyMenu(anchor, composer, conv) {
    ui.menu(anchor, [{ group: 'Respuestas rápidas' }].concat(
      store.state.quickReplies.map(function (r) {
        return {
          icon: 'bolt', label: r.title, hint: '/' + r.shortcut,
          onClick: function () { applyQuickReply(composer, r.id, conv); }
        };
      })
    ).concat([
      { sep: true },
      { icon: 'plus', label: 'Administrar respuestas', onClick: function () { NS.app.go('ajustes', { tab: 'respuestas' }); } }
    ]), { align: 'right' });
  }

  function emojiMenu(anchor, composer) {
    const menu = el('div', { class: 'menu', style: { padding: '10px', width: '270px' } });
    menu.innerHTML = '<div class="menu-label" style="padding-top:0">Emojis</div>' +
      '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px">' +
      EMOJIS.map(function (e) {
        return '<button class="btn btn-ghost btn-icon btn-sm" data-emoji="' + e + '" style="font-size:16px">' + e + '</button>';
      }).join('') + '</div>';
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = util.clamp(r.right - menu.offsetWidth, 10, innerWidth - menu.offsetWidth - 10) + 'px';
    menu.style.top = Math.max(10, r.top - menu.offsetHeight - 8) + 'px';
    menu.style.setProperty('--origin', 'bottom right');
    const close = function () { menu.remove(); document.removeEventListener('pointerdown', out, true); };
    const out = function (e) { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener('pointerdown', out, true); }, 0);
    dom.on(menu, 'click', '[data-emoji]', function () {
      const pos = composer.selectionStart || composer.value.length;
      composer.value = composer.value.slice(0, pos) + this.dataset.emoji + composer.value.slice(pos);
      composer.focus();
      composer.setSelectionRange(pos + this.dataset.emoji.length, pos + this.dataset.emoji.length);
      composer.dispatchEvent(new Event('input'));
    });
  }

  /* -------------------------------------------------------- plantillas */
  function templatePicker(conv) {
    const contact = store.contact(conv.contactId);
    const aprobadas = store.state.templates.filter(function (t) { return t.status === 'aprobada'; });
    if (!aprobadas.length) {
      ui.toast('No hay plantillas aprobadas. Creá una en Ajustes.', 'warn');
      return;
    }

    const wrap = el('div', { class: 'stack', style: { gap: '12px' } });
    let selected = aprobadas[0];
    const vars = {};

    const render = function () {
      const varsHTML = (selected.variables || []).map(function (v, i) {
        return '<div class="field"><label class="label">{{' + (i + 1) + '}} · ' + esc(v) + '</label>' +
          '<input class="input" data-var="' + (i + 1) + '" value="' + esc(vars[i + 1] || '') + '" placeholder="' + esc(v) + '"></div>';
      }).join('');
      const preview = util.interpolate(selected.body, Object.assign({}, vars));

      wrap.innerHTML =
        '<div class="field"><label class="label">Plantilla</label>' +
        '<select class="select" id="tpl-sel">' + aprobadas.map(function (t) {
          return '<option value="' + t.id + '"' + (t.id === selected.id ? ' selected' : '') + '>' +
            esc(t.name) + ' · ' + esc(t.category) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">' +
        '<div class="stack" style="gap:12px;flex:1;min-width:220px">' + (varsHTML || '<div class="hint">Esta plantilla no tiene variables.</div>') + '</div>' +
        '<div class="phone-preview"><div class="t-xs faint" style="text-align:center">Vista previa</div>' +
        '<div class="phone-screen"><div class="preview-bubble">' +
        (selected.header ? '<div class="pb-head">' + esc(selected.header) + '</div>' : '') +
        util.waFormat(preview) +
        (selected.footer ? '<div class="pb-foot">' + esc(selected.footer) + '</div>' : '') +
        (selected.buttons || []).map(function (b) { return '<div class="preview-btn">' + esc(b.text) + '</div>'; }).join('') +
        '</div></div></div>' +
        '</div>';

      wrap.querySelector('#tpl-sel').addEventListener('change', function () {
        selected = store.template(this.value);
        Object.keys(vars).forEach(function (k) { delete vars[k]; });
        vars[1] = (contact.name || '').split(' ')[0];
        render();
      });
      dom.on(wrap, 'input', '[data-var]', function () { vars[this.dataset.var] = this.value; });
      dom.on(wrap, 'change', '[data-var]', function () { render(); });
    };

    vars[1] = (contact.name || '').split(' ')[0];
    render();

    ui.modal({
      title: 'Enviar plantilla', subtitle: 'Mensajes fuera de la ventana de 24 horas', icon: 'template',
      size: 'wide', body: wrap,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Enviar plantilla', variant: 'primary',
          onClick: function () {
            const body = util.interpolate(selected.body, vars);
            wa.send(conv, { type: 'template', templateId: selected.id, body: body, vars: vars });
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------- menús */
  function assignMenu(conv, anchor) {
    const items = [{ group: 'Asignar a' }];
    store.state.agents.filter(function (a) { return a.active; }).forEach(function (a) {
      items.push({
        icon: 'users', label: a.name, checked: conv.assignedTo === a.id,
        onClick: function () {
          store.commit(function () {
            conv.assignedTo = a.id;
            store.log('conv', 'asignó una conversación a ' + a.name);
          }, 'conv');
          ui.toast('Asignado a ' + a.name, 'ok');
          renderThread(); renderList();
        }
      });
    });
    items.push({ sep: true });
    items.push({
      icon: 'x', label: 'Quitar asignación',
      onClick: function () {
        store.commit(function () { conv.assignedTo = null; }, 'conv');
        renderThread(); renderList();
      }
    });
    ui.menu(anchor, items, { align: 'right' });
  }

  function statusMenu(conv, anchor) {
    const set = function (s) {
      store.commit(function () {
        conv.status = s;
        conv.closedAt = s === 'closed' ? Date.now() : null;
        if (s === 'closed') store.log('conv', 'cerró una conversación');
      }, 'conv');
      renderThread(); renderList();
      if (s === 'closed') { ui.toast('Conversación cerrada', 'ok'); ui.sound('done'); }
    };
    ui.menu(anchor, [
      { group: 'Estado' },
      { icon: 'inbox', label: 'Abierta', checked: conv.status === 'open', onClick: function () { set('open'); } },
      { icon: 'clock', label: 'En espera', checked: conv.status === 'pending', onClick: function () { set('pending'); } },
      { icon: 'check', label: 'Cerrada', checked: conv.status === 'closed', onClick: function () { set('closed'); } }
    ], { align: 'right' });
  }

  function snoozeMenu(conv, anchor) {
    const opciones = [
      { label: '30 minutos', ms: 30 * 60000 },
      { label: '2 horas', ms: 2 * 3600000 },
      { label: 'Mañana a las 9', ms: null, calc: function () { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime() - Date.now(); } },
      { label: 'La semana que viene', ms: 7 * 86400000 }
    ];
    ui.menu(anchor, [{ group: 'Posponer hasta' }].concat(opciones.map(function (o) {
      return {
        icon: 'snooze', label: o.label, onClick: function () {
          const ms = o.ms != null ? o.ms : o.calc();
          store.commit(function () { conv.snoozeUntil = Date.now() + ms; conv.status = 'pending'; }, 'conv');
          ui.toast('Pospuesta ' + o.label.toLowerCase(), 'ok');
          renderThread(); renderList();
        }
      };
    })).concat(conv.snoozeUntil ? [{ sep: true }, {
      icon: 'x', label: 'Quitar posposición', onClick: function () {
        store.commit(function () { conv.snoozeUntil = null; }, 'conv');
        renderThread();
      }
    }] : []), { align: 'right' });
  }

  function convMenu(conv, anchor) {
    const contact = store.contact(conv.contactId);
    ui.menu(anchor, [
      {
        icon: 'pin', label: conv.pinned ? 'Dejar de fijar' : 'Fijar arriba', onClick: function () {
          store.commit(function () { conv.pinned = !conv.pinned; }, 'conv'); renderList();
        }
      },
      {
        icon: 'bell', label: 'Marcar como no leída', onClick: function () {
          store.commit(function () { conv.unread = 1; }, 'conv');
          state.selected = null; renderList(); renderThread();
        }
      },
      { icon: 'tag', label: 'Etiquetar conversación', onClick: function () { tagPicker(conv); } },
      { sep: true },
      {
        icon: 'link', label: 'Abrir en WhatsApp', onClick: function () {
          window.open(wa.waLink(contact.phone, ''), '_blank', 'noopener');
        }
      },
      {
        icon: 'download', label: 'Exportar hilo (.txt)', onClick: function () {
          const txt = conv.messages.map(function (m) {
            const quien = m.dir === 'in' ? contact.name : m.dir === 'note' ? 'NOTA INTERNA' : store.state.workspace.name;
            return '[' + util.fmtDate(m.at) + ' ' + util.fmtTime(m.at) + '] ' + quien + ': ' + m.body;
          }).join('\n');
          util.download('chat-' + util.slug(contact.name) + '.txt', txt);
        }
      },
      {
        icon: 'copy', label: 'Copiar teléfono', onClick: function () {
          util.copy(util.phone(contact.phone)); ui.toast('Teléfono copiado', 'ok');
        }
      },
      { sep: true },
      {
        icon: 'trash', label: 'Eliminar conversación', variant: 'danger', onClick: function () {
          ui.confirm({
            title: 'Eliminar conversación', danger: true, confirmText: 'Eliminar',
            message: 'Se borrará el historial de mensajes con ' + contact.name + '. El contacto se conserva.'
          }).then(function (ok) {
            if (!ok) return;
            store.commit(function (s) {
              s.conversations = s.conversations.filter(function (c) { return c.id !== conv.id; });
            }, 'conv');
            state.selected = null;
            renderList(); renderThread(); renderCtx();
            ui.toast('Conversación eliminada', 'ok');
          });
        }
      }
    ], { align: 'right' });
  }

  function tagPicker(conv) {
    const items = store.state.tags.map(function (t) {
      return {
        icon: 'tag', label: t.name, checked: conv.tags.indexOf(t.id) >= 0,
        onClick: function () {
          store.commit(function () {
            const i = conv.tags.indexOf(t.id);
            if (i >= 0) conv.tags.splice(i, 1); else conv.tags.push(t.id);
          }, 'conv');
          renderList(); renderCtx();
        }
      };
    });
    ui.menu(threadEl.querySelector('[data-act="more"]') || threadEl, [{ group: 'Etiquetas' }].concat(items), { align: 'right' });
  }

  /* -------------------------------------------------- panel de contexto */
  function renderCtx() {
    const conv = state.selected ? store.conversation(state.selected) : null;
    if (!conv) {
      ctxEl.innerHTML = '<div class="ctx-sec"><div class="ctx-title">Ficha</div>' +
        '<div class="t-sm faint">Elegí una conversación para ver los datos del contacto.</div></div>';
      return;
    }
    const c = store.contact(conv.contactId);
    const deals = store.dealsOf(c.id);
    const tasks = store.tasksOf(c.id).filter(function (t) { return !t.done; });
    const tags = c.tags.map(store.tag.bind(store)).filter(Boolean);
    const notas = c.notes || [];

    ctxEl.innerHTML =
      '<div class="scroll" style="flex:1">' +

      '<div class="ctx-sec" style="text-align:center;padding-top:20px">' +
      '<div style="display:flex;justify-content:center;margin-bottom:11px">' +
      ui.avatarHTML(c.name, { size: 'xl', seed: c.id }) + '</div>' +
      '<div class="t-lg">' + esc(c.name) + '</div>' +
      '<div class="t-sm faint">' + esc(util.phone(c.phone)) + '</div>' +
      '<div class="row-gap" style="justify-content:center;margin-top:11px;gap:6px">' +
      '<button class="btn btn-sm btn-outline" data-act="wa">' + icon('whatsapp', 14) + 'WhatsApp</button>' +
      '<button class="btn btn-sm btn-outline" data-act="copy-phone" title="Copiar teléfono">' + icon('phone', 14) + '</button>' +
      '<button class="btn btn-sm btn-outline" data-act="edit-contact" title="Editar contacto">' + icon('edit', 14) + '</button>' +
      '</div>' +
      '</div>' +

      '<div class="ctx-sec">' +
      '<div class="ctx-title">' + icon('tag', 12) + 'Etiquetas</div>' +
      '<div class="pills">' + (tags.length ? tags.map(function (t) { return ui.tagHTML(t, true); }).join('') :
        '<span class="t-xs faint">Sin etiquetas</span>') +
      '<button class="pill" data-act="add-tag">' + icon('plus', 12) + '</button></div>' +
      '</div>' +

      '<div class="ctx-sec">' +
      '<div class="ctx-title">' + icon('info', 12) + 'Datos</div>' +
      '<dl class="kv">' +
      (c.company ? '<dt>Empresa</dt><dd>' + esc(c.company) + '</dd>' : '') +
      (c.email ? '<dt>Email</dt><dd>' + esc(c.email) + '</dd>' : '') +
      (c.city ? '<dt>Ciudad</dt><dd>' + esc(c.city) + '</dd>' : '') +
      '<dt>Origen</dt><dd>' + esc(c.source || '—') + '</dd>' +
      '<dt>Cliente desde</dt><dd>' + esc(util.fmtDate(c.createdAt)) + '</dd>' +
      '<dt>Promociones</dt><dd>' + (c.optIn ? 'Acepta' : 'No acepta') + '</dd>' +
      Object.keys(c.custom || {}).map(function (k) {
        return '<dt>' + esc(k) + '</dt><dd>' + esc(c.custom[k]) + '</dd>';
      }).join('') +
      '</dl>' +
      '<button class="btn btn-sm btn-ghost" data-act="add-field" style="margin-top:8px">' + icon('plus', 13) + 'Campo personalizado</button>' +
      '</div>' +

      '<div class="ctx-sec">' +
      '<div class="ctx-title">' + icon('funnel', 12) + 'Negocios<span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="add-deal">' + icon('plus', 14) + '</button></div>' +
      (deals.length ? deals.map(function (d) {
        const stg = store.stage(d.stageId);
        return '<div class="mini-item" data-act="open-deal" data-id="' + d.id + '">' +
          '<div class="stack" style="min-width:0;gap:2px;flex:1">' +
          '<span class="t-sm strong truncate">' + esc(d.title) + '</span>' +
          '<span class="row-gap"><span class="chip" data-color="' + esc(stg ? stg.color : 'neutral') + '">' +
          esc(stg ? stg.name : '—') + '</span>' +
          '<span class="t-xs t-num faint">' + esc(util.moneyCompact(d.value, d.currency)) + '</span></span>' +
          '</div></div>';
      }).join('') : '<div class="t-xs faint">Sin negocios asociados</div>') +
      '</div>' +

      '<div class="ctx-sec">' +
      '<div class="ctx-title">' + icon('task', 12) + 'Tareas<span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="add-task">' + icon('plus', 14) + '</button></div>' +
      (tasks.length ? tasks.map(function (t) {
        const vencida = t.dueAt < Date.now();
        return '<div class="mini-item">' +
          '<button class="check" role="checkbox" aria-checked="false" data-act="done-task" data-id="' + t.id + '">' + icon('check', 12) + '</button>' +
          '<div class="stack" style="min-width:0;gap:1px;flex:1">' +
          '<span class="t-sm truncate">' + esc(t.title) + '</span>' +
          '<span class="t-xs ' + (vencida ? '' : 'faint') + '" style="' + (vencida ? 'color:var(--danger-fg)' : '') + '">' +
          (vencida ? 'Vencida · ' : '') + esc(util.fmtDateShort(t.dueAt)) + ' ' + esc(util.fmtTime(t.dueAt)) + '</span>' +
          '</div></div>';
      }).join('') : '<div class="t-xs faint">Sin tareas pendientes</div>') +
      '</div>' +

      '<div class="ctx-sec">' +
      '<div class="ctx-title">' + icon('note', 12) + 'Notas del contacto<span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="add-note">' + icon('plus', 14) + '</button></div>' +
      (notas.length ? notas.slice().reverse().map(function (n) {
        const a = n.author ? store.agent(n.author) : null;
        return '<div class="mini-item" style="cursor:default"><div class="stack" style="gap:3px;min-width:0">' +
          '<span class="t-sm">' + esc(n.text) + '</span>' +
          '<span class="t-xs faint">' + esc(a ? a.name : '—') + ' · ' + esc(util.relTime(n.at)) + '</span>' +
          '</div></div>';
      }).join('') : '<div class="t-xs faint">Sin notas</div>') +
      '</div>' +

      '<div class="ctx-sec" style="border-bottom:0">' +
      '<div class="ctx-title">' + icon('clock', 12) + 'Resumen</div>' +
      ui.metaRow('Mensajes', util.num(conv.messages.length)) +
      ui.metaRow('Primera respuesta', conv.firstInboundAt && conv.firstResponseAt ?
        util.dur((conv.firstResponseAt - conv.firstInboundAt) / 60000) : '—') +
      ui.metaRow('Inicio', util.fmtDate(conv.createdAt)) +
      '</div>' +

      '</div>';

  }

  /* ---------------------------------------------------------------------
     Delegación única. Se registra al montar la vista y resuelve siempre la
     conversación y el contacto actuales, así ningún escucha queda atado a
     un dibujado anterior.
     --------------------------------------------------------------------- */
  function wireOnce() {

    /* ---- lista de conversaciones ---- */
    dom.on(listEl, 'click', '[data-filter]', function () {
      state.filter = this.dataset.filter;
      renderList();
    });
    dom.on(listEl, 'click', '[data-act="clear-filters"]', function () {
      state.tagFilter = ''; state.agentFilter = '';
      renderList();
    });
    dom.on(listEl, 'click', '.conv-item', function () {
      openConversation(this.dataset.id);
    });
    dom.on(listEl, 'contextmenu', '.conv-item', function (e) {
      e.preventDefault();
      convMenu(store.conversation(this.dataset.id), this);
    });

    /* ---- hilo y redactor ---- */
    dom.on(threadEl, 'click', '[data-act="send"]', function () {
      const conv = curConv(), composer = curComposer();
      if (conv && composer) doSend(conv, composer);
    });
    dom.on(threadEl, 'click', '.composer-tab', function () {
      const composer = curComposer();
      const val = composer ? composer.value : '';
      state.composerMode = this.dataset.mode;
      renderThread();
      const c2 = curComposer();
      if (c2) { c2.value = val; c2.focus(); c2.dispatchEvent(new Event('input')); }
    });
    dom.on(threadEl, 'click', '[data-act="back"]', function () {
      state.mobile = 'list'; syncMobile();
    });
    dom.on(threadEl, 'click', '[data-act="panel"]', function () {
      state.panel = !state.panel; syncPanel();
    });
    dom.on(threadEl, 'click', '[data-act="assign"]', function () { assignMenu(curConv(), this); });
    dom.on(threadEl, 'click', '[data-act="status"]', function () { statusMenu(curConv(), this); });
    dom.on(threadEl, 'click', '[data-act="snooze"]', function () { snoozeMenu(curConv(), this); });
    dom.on(threadEl, 'click', '[data-act="more"]', function () { convMenu(curConv(), this); });
    dom.on(threadEl, 'click', '[data-act="emoji"]', function () { emojiMenu(this, curComposer()); });
    dom.on(threadEl, 'click', '[data-act="quick"]', function () { quickReplyMenu(this, curComposer(), curConv()); });
    dom.on(threadEl, 'click', '[data-act="template"]', function () { templatePicker(curConv()); });
    dom.on(threadEl, 'click', '[data-act="attach"]', function () {
      const f = threadEl.querySelector('#file-input');
      if (f) f.click();
    });
    dom.on(threadEl, 'click', '[data-act="reopen"]', function () {
      const conv = curConv();
      if (!conv) return;
      store.commit(function () { conv.status = 'open'; conv.closedAt = null; }, 'conv');
      renderThread(); renderList();
    });
    dom.on(threadEl, 'click', '[data-act="retry"]', function () {
      const conv = curConv();
      if (!conv) return;
      const mid = this.dataset.mid;
      const i = conv.messages.findIndex(function (x) { return x.id === mid; });
      if (i < 0) return;
      const body = conv.messages[i].body;
      conv.messages.splice(i, 1);
      wa.send(conv, { type: 'text', body: body });
    });
    dom.on(threadEl, 'click', '.qr-item', function () {
      applyQuickReply(curComposer(), this.dataset.id, curConv());
    });

    /* ---- ficha del contacto ---- */
    dom.on(ctxEl, 'click', '[data-act="wa"]', function () {
      const c = curContact();
      if (c) window.open(wa.waLink(c.phone, ''), '_blank', 'noopener');
    });
    dom.on(ctxEl, 'click', '[data-act="copy-phone"]', function () {
      const c = curContact();
      if (!c) return;
      util.copy(util.phone(c.phone));
      ui.toast('Teléfono copiado', 'ok');
    });
    dom.on(ctxEl, 'click', '[data-act="edit-contact"]', function () {
      const c = curContact();
      if (c) NS.contacts.editContact(c.id, function () { renderCtx(); renderList(); renderThread(); });
    });
    dom.on(ctxEl, 'click', '[data-act="add-tag"]', function () {
      const c = curContact();
      if (!c) return;
      const anchor = this;
      ui.menu(anchor, [{ group: 'Etiquetas' }].concat(store.state.tags.map(function (t) {
        return {
          icon: 'tag', label: t.name, checked: c.tags.indexOf(t.id) >= 0,
          onClick: function () {
            store.commit(function () {
              const i = c.tags.indexOf(t.id);
              if (i >= 0) c.tags.splice(i, 1); else c.tags.push(t.id);
            }, 'contact');
            renderCtx(); renderList();
          }
        };
      })).concat([{ sep: true }, {
        icon: 'plus', label: 'Nueva etiqueta', onClick: function () {
          NS.settings.newTag(function (tag) {
            if (!tag) return;
            store.commit(function () { c.tags.push(tag.id); }, 'contact');
            renderCtx();
          });
        }
      }]), { align: 'right' });
    });
    dom.on(ctxEl, 'click', '[data-act="untag"]', function (e) {
      e.stopPropagation();
      const c = curContact();
      if (!c) return;
      const id = this.dataset.id;
      store.commit(function () {
        const i = c.tags.indexOf(id);
        if (i >= 0) c.tags.splice(i, 1);
      }, 'contact');
      renderCtx(); renderList();
    });
    dom.on(ctxEl, 'click', '[data-act="add-field"]', function () {
      const c = curContact();
      if (!c) return;
      ui.form({
        title: 'Campo personalizado', icon: 'edit',
        fields: [
          { key: 'nombre', label: 'Nombre del campo', required: true, placeholder: 'Ej: CUIT, Condición IVA, Zona' },
          { key: 'valor', label: 'Valor', required: true }
        ]
      }).then(function (r) {
        if (!r) return;
        store.commit(function () { c.custom[r.nombre] = r.valor; }, 'contact');
        renderCtx();
      });
    });
    dom.on(ctxEl, 'click', '[data-act="add-deal"]', function () {
      const c = curContact();
      if (c) NS.pipeline.newDeal(c.id, function () { renderCtx(); });
    });
    dom.on(ctxEl, 'click', '[data-act="open-deal"]', function () {
      NS.pipeline.openDeal(this.dataset.id, function () { renderCtx(); });
    });
    dom.on(ctxEl, 'click', '[data-act="add-task"]', function () {
      const c = curContact();
      if (!c) return;
      ui.form({
        title: 'Nueva tarea', icon: 'task',
        fields: [
          { key: 'title', label: 'Tarea', required: true, placeholder: 'Ej: Llamar para cerrar el pedido' },
          { key: 'due', label: 'Vence', type: 'datetime-local', value: localDT(Date.now() + 86400000) }
        ]
      }).then(function (r) {
        if (!r) return;
        store.commit(function (s) {
          s.tasks.push({
            id: util.uid('tk'), contactId: c.id, title: r.title,
            dueAt: r.due ? new Date(r.due).getTime() : Date.now() + 86400000,
            done: false, ownerId: (store.me() || {}).id, createdAt: Date.now()
          });
        }, 'task');
        renderCtx();
        ui.toast('Tarea creada', 'ok');
      });
    });
    dom.on(ctxEl, 'click', '[data-act="done-task"]', function () {
      const id = this.dataset.id;
      this.setAttribute('aria-checked', 'true');
      setTimeout(function () {
        store.commit(function (s) {
          const t = s.tasks.find(function (x) { return x.id === id; });
          if (t) t.done = true;
        }, 'task');
        renderCtx();
      }, 180);
    });
    dom.on(ctxEl, 'click', '[data-act="add-note"]', function () {
      const c = curContact();
      if (!c) return;
      ui.form({
        title: 'Nota del contacto', icon: 'note',
        fields: [{ key: 'text', label: 'Nota', type: 'textarea', required: true, rows: 4 }]
      }).then(function (r) {
        if (!r) return;
        store.commit(function () {
          c.notes = c.notes || [];
          c.notes.push({ id: util.uid('n'), text: r.text, at: Date.now(), author: (store.me() || {}).id });
        }, 'contact');
        renderCtx();
      });
    });
  }

  function localDT(ts) {
    const d = new Date(ts);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* --------------------------------------------------------- adaptación */
  function syncPanel() { inboxEl.dataset.panel = state.panel ? 'on' : 'off'; }
  function syncMobile() { inboxEl.dataset.mobile = state.mobile; }

  /* --------------------------------------------------------------- vista */
  NS.views = NS.views || {};
  NS.views.inbox = {
    title: 'Bandeja de entrada',
    icon: 'inbox',
    mount: function (container, params) {
      root = container;
      root.innerHTML = '<div class="inbox" data-panel="on" data-mobile="list">' +
        '<div class="conv-list"></div>' +
        '<div class="thread"></div>' +
        '<div class="ctx"></div>' +
        '</div>';
      inboxEl = root.querySelector('.inbox');
      listEl = root.querySelector('.conv-list');
      threadEl = root.querySelector('.thread');
      ctxEl = root.querySelector('.ctx');

      if (params && params.conv) state.selected = params.conv;
      if (params && params.filter) state.filter = params.filter;

      wireOnce();
      renderList();
      if (state.selected && store.conversation(state.selected)) openConversation(state.selected);
      else { renderThread(); renderCtx(); }
      syncPanel(); syncMobile();

      /* refresco puntual: la lista y el hilo se redibujan por separado */
      const onMsg = function (p) {
        renderList();
        if (p && p.convId === state.selected) {
          const conv = store.conversation(state.selected);
          if (conv) {
            renderMessages(conv);
            if (p.inbound && conv.unread) store.commit(function () { conv.unread = 0; }, null);
          }
        }
        renderCtx();
      };
      unsub.push(store.on('message', onMsg));
      unsub.push(store.on('message-status', function (p) {
        if (p && p.convId === state.selected) {
          const conv = store.conversation(state.selected);
          if (conv) renderMessages(conv);
        }
        renderList();
      }));
      unsub.push(store.on('conv', function () { renderList(); }));
      unsub.push(store.on('contact', function () { renderList(); }));

      return {
        destroy: function () {
          unsub.forEach(function (f) { f(); });
          unsub = [];
        }
      };
    },
    /* usado por la paleta de comandos y las notificaciones */
    select: function (id) { openConversation(id); },
    state: state
  };

  NS.inbox = NS.views.inbox;

})(window.CRM);
