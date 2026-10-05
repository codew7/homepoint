/* =========================================================================
   Nexo CRM · automatizaciones
   Reglas "cuando pasa esto → hacé aquello", con constructor visual y
   plantillas listas para activar en un clic.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  let root;

  const TRIGGERS = {
    first_message: { label: 'Primer mensaje de un contacto nuevo', icon: 'sparkle' },
    new_conversation: { label: 'Se abre una conversación nueva', icon: 'inbox' },
    keyword: { label: 'El cliente escribe una palabra clave', icon: 'search' },
    message_out_of_hours: { label: 'Llega un mensaje fuera de horario', icon: 'clock' },
    no_reply: { label: 'Una conversación queda sin responder', icon: 'bell' }
  };

  const ACTIONS = {
    reply: { label: 'Responder con un mensaje', icon: 'send' },
    tag: { label: 'Agregar una etiqueta', icon: 'tag' },
    assign: { label: 'Asignar a un agente', icon: 'handoff' },
    stage: { label: 'Mover al embudo', icon: 'funnel' },
    task: { label: 'Crear una tarea', icon: 'task' },
    status: { label: 'Cambiar el estado', icon: 'check' }
  };

  const RECETAS = [
    {
      name: 'Saludar al instante', icon: 'sparkle',
      desc: 'Responde en segundos al primer mensaje para que nadie quede esperando.',
      rule: {
        trigger: { type: 'first_message' },
        actions: [{ type: 'reply', text: '¡Hola! Gracias por escribir a {{negocio}} 👋 Ya te leemos, en un momento te responde una persona del equipo.' }]
      }
    },
    {
      name: 'Avisar fuera de horario', icon: 'clock',
      desc: 'Contesta con tu horario cuando escriben de noche o el fin de semana.',
      rule: { trigger: { type: 'message_out_of_hours' }, actions: [{ type: 'reply', text: '{{ausencia}}' }] }
    },
    {
      name: 'Repartir entre el equipo', icon: 'handoff',
      desc: 'Asigna cada conversación nueva al siguiente agente disponible.',
      rule: { trigger: { type: 'new_conversation' }, actions: [{ type: 'assign', mode: 'round_robin' }] }
    },
    {
      name: 'Detectar intención de compra', icon: 'dollar',
      desc: 'Etiqueta y sube al embudo a quien pregunta precios.',
      rule: {
        trigger: { type: 'keyword', keywords: 'precio, cuanto sale, cotización, lista' },
        actions: [{ type: 'tag', tagId: 'tag_lead' }, { type: 'stage', stageId: 'st_nuevo' }]
      }
    },
    {
      name: 'Escalar reclamos', icon: 'warn',
      desc: 'Marca el reclamo, avisa al supervisor y agenda la revisión.',
      rule: {
        trigger: { type: 'keyword', keywords: 'reclamo, roto, no funciona, dañado, falta' },
        actions: [{ type: 'tag', tagId: 'tag_reclamo' }, { type: 'task', title: 'Revisar reclamo', dueIn: 60 }]
      }
    },
    {
      name: 'Rescatar conversaciones frías', icon: 'bell',
      desc: 'Genera una tarea si pasan 30 minutos sin que nadie responda.',
      rule: {
        trigger: { type: 'no_reply', minutes: 30 },
        actions: [{ type: 'task', title: 'Responder conversación demorada', dueIn: 15 }]
      }
    }
  ];

  /* -------------------------------------------------------------- render */
  function render() {
    const rules = store.state.automations;
    const activas = rules.filter(function (r) { return r.active; }).length;
    const corridas = util.sum(rules, function (r) { return (r.stats && r.stats.runs) || 0; });

    root.innerHTML =
      '<div class="row-gap" style="padding:12px 16px;gap:9px;border-bottom:1px solid var(--line);flex-wrap:wrap">' +
      '<div class="stack" style="gap:0">' +
      '<span class="t-md">Automatizaciones</span>' +
      '<span class="t-xs faint">' + activas + ' activas · ' + util.num(corridas) + ' ejecuciones registradas</span>' +
      '</div>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-outline" data-act="hours">' + icon('clock', 14) + 'Horario de atención</button>' +
      '<button class="btn btn-sm btn-primary" data-act="new">' + icon('plus', 14) + 'Nueva regla</button>' +
      '</div>' +
      '<div class="scroll pad" style="flex:1">' +

      '<div class="section-title"><span class="t-lg t-serif">Tus reglas</span>' +
      '<span class="t-sm faint">Se ejecutan en orden, de arriba hacia abajo</span></div>' +
      '<div class="stack" style="gap:10px">' +
      (rules.length ? rules.map(ruleHTML).join('') :
        '<div class="card card-pad"><div class="t-sm faint">Todavía no configuraste ninguna regla.</div></div>') +
      '</div>' +

      '<div class="section-title" style="margin-top:26px"><span class="t-lg t-serif">Recetas listas</span>' +
      '<span class="t-sm faint">Un clic y queda funcionando</span></div>' +
      '<div class="grid-3">' + RECETAS.map(recetaHTML).join('') + '</div>' +

      '</div>';
  }

  function ruleHTML(r) {
    const t = TRIGGERS[r.trigger.type] || { label: r.trigger.type, icon: 'bolt' };
    return '<div class="card" data-id="' + r.id + '">' +
      '<div class="card-pad row-gap" style="gap:13px;align-items:flex-start">' +
      '<span class="empty-mark" style="width:38px;height:38px;border-radius:11px;' +
      (r.active ? 'background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)' : '') + '">' +
      icon(r.icon || t.icon, 18) + '</span>' +

      '<div class="stack" style="gap:6px;flex:1;min-width:0">' +
      '<span class="t-md truncate">' + esc(r.name) + '</span>' +
      '<div class="row-gap wrap" style="gap:6px">' +
      '<span class="chip" data-color="blue">' + icon('bolt', 10) + esc(triggerSummary(r)) + '</span>' +
      r.actions.map(function (a) {
        return '<span class="chip" data-color="neutral">' + icon((ACTIONS[a.type] || {}).icon || 'check', 10) +
          esc(actionSummary(a)) + '</span>';
      }).join('') +
      '</div>' +
      (r.stats && r.stats.runs ? '<span class="t-xs faint">Se ejecutó ' + util.num(r.stats.runs) + ' veces' +
        (r.stats.lastRun ? ' · última ' + esc(util.relTime(r.stats.lastRun)) : '') + '</span>' : '') +
      '</div>' +

      '<div class="row-gap" style="gap:4px">' +
      '<button class="switch" role="switch" aria-checked="' + (r.active ? 'true' : 'false') + '" data-act="toggle" data-id="' + r.id + '"></button>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="menu" data-id="' + r.id + '">' + icon('more', 15) + '</button>' +
      '</div>' +
      '</div></div>';
  }

  function recetaHTML(rc, i) {
    return '<button class="choice" data-receta="' + i + '">' +
      '<span class="choice-mark">' + icon(rc.icon, 18) + '</span>' +
      '<span class="stack" style="gap:3px;min-width:0">' +
      '<span class="t-sm strong">' + esc(rc.name) + '</span>' +
      '<span class="t-xs faint">' + esc(rc.desc) + '</span>' +
      '</span></button>';
  }

  function triggerSummary(r) {
    const t = r.trigger;
    if (t.type === 'keyword') return 'Si dice: ' + util.truncate(t.keywords || '', 34);
    if (t.type === 'no_reply') return 'Sin responder ' + (t.minutes || 30) + ' min';
    return (TRIGGERS[t.type] || {}).label || t.type;
  }

  function actionSummary(a) {
    switch (a.type) {
      case 'reply': return 'Responder: ' + util.truncate(a.text || '', 30);
      case 'tag': return 'Etiquetar ' + ((store.tag(a.tagId) || {}).name || '—');
      case 'assign': return a.mode === 'agent' ? 'Asignar a ' + ((store.agent(a.agentId) || {}).name || '—') : 'Repartir entre el equipo';
      case 'stage': return 'Mover a ' + ((store.stage(a.stageId) || {}).name || '—');
      case 'task': return 'Crear tarea: ' + util.truncate(a.title || '', 24);
      case 'status': return 'Estado: ' + (a.status || 'pending');
      default: return a.type;
    }
  }

  /* ------------------------------------------------------------- eventos */
  /* Delegación registrada una sola vez, al montar. */
  function wireOnce() {
    dom.on(root, 'click', '[data-act="toggle"]', function () {
      const id = this.dataset.id;
      store.commit(function (s) {
        const r = s.automations.find(function (x) { return x.id === id; });
        if (r) r.active = !r.active;
      }, 'automation');
      render();
    });
    dom.on(root, 'click', '[data-act="menu"]', function () { ruleMenu(this.dataset.id, this); });
    dom.on(root, 'click', '[data-act="new"]', function () { builder(null); });
    dom.on(root, 'click', '[data-act="hours"]', hoursDialog);
    dom.on(root, 'click', '[data-receta]', function () {
      const rc = RECETAS[Number(this.dataset.receta)];
      const rule = Object.assign({
        id: util.uid('au'), name: rc.name, active: true, icon: rc.icon,
        conditions: [], stats: { runs: 0 }
      }, JSON.parse(JSON.stringify(rc.rule)));
      store.commit(function (s) { s.automations.push(rule); }, 'automation');
      ui.toast('Regla “' + rc.name + '” activada', 'ok');
      ui.sound('done');
      render();
    });
  }

  function ruleMenu(id, anchor) {
    const r = store.state.automations.find(function (x) { return x.id === id; });
    ui.menu(anchor, [
      { icon: 'edit', label: 'Editar regla', onClick: function () { builder(id); } },
      {
        icon: 'template', label: 'Duplicar', onClick: function () {
          store.commit(function (s) {
            s.automations.push(Object.assign(JSON.parse(JSON.stringify(r)), {
              id: util.uid('au'), name: r.name + ' (copia)', active: false, stats: { runs: 0 }
            }));
          }, 'automation');
          render();
        }
      },
      { sep: true },
      {
        icon: 'trash', label: 'Eliminar', variant: 'danger', onClick: function () {
          ui.confirm({ title: 'Eliminar regla', message: 'Se elimina “' + r.name + '”.', danger: true, confirmText: 'Eliminar' })
            .then(function (ok) {
              if (!ok) return;
              store.commit(function (s) { s.automations = s.automations.filter(function (x) { return x.id !== id; }); }, 'automation');
              render();
            });
        }
      }
    ], { align: 'right' });
  }

  /* ---------------------------------------------------------- constructor */
  function builder(id) {
    const editando = !!id;
    const rule = editando
      ? JSON.parse(JSON.stringify(store.state.automations.find(function (x) { return x.id === id; })))
      : { id: util.uid('au'), name: '', active: true, icon: 'bolt', trigger: { type: 'first_message' }, conditions: [], actions: [], stats: { runs: 0 } };

    const wrap = el('div', { class: 'stack', style: { gap: '16px' } });

    function draw() {
      wrap.innerHTML =
        '<div class="field"><label class="label">Nombre de la regla</label>' +
        '<input class="input" id="r-name" value="' + esc(rule.name) + '" placeholder="Ej: Saludar al primer mensaje"></div>' +

        '<div class="card"><div class="card-head">' +
        '<span class="chip" data-color="accent">CUANDO</span>' +
        '<span class="t-sm faint">se cumpla esta condición</span></div>' +
        '<div class="card-pad stack" style="gap:12px">' +
        '<select class="select" id="r-trigger">' + Object.keys(TRIGGERS).map(function (k) {
          return '<option value="' + k + '"' + (rule.trigger.type === k ? ' selected' : '') + '>' + esc(TRIGGERS[k].label) + '</option>';
        }).join('') + '</select>' +
        (rule.trigger.type === 'keyword' ?
          '<div class="field"><label class="label">Palabras clave</label>' +
          '<input class="input" id="r-keywords" value="' + esc(rule.trigger.keywords || '') + '" placeholder="precio, envío, horario">' +
          '<div class="hint">Separadas por coma. No distingue mayúsculas ni acentos.</div></div>' : '') +
        (rule.trigger.type === 'no_reply' ?
          '<div class="field"><label class="label">Minutos sin respuesta</label>' +
          '<input class="input" type="number" id="r-minutes" min="5" max="1440" value="' + (rule.trigger.minutes || 30) + '"></div>' : '') +
        '</div></div>' +

        '<div class="card"><div class="card-head">' +
        '<span class="chip" data-color="accent">ENTONCES</span>' +
        '<span class="t-sm faint">hacé esto, en orden</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm btn-outline" data-act="add-action">' + icon('plus', 13) + 'Agregar acción</button>' +
        '</div>' +
        '<div class="card-pad stack" style="gap:10px" id="r-actions">' +
        (rule.actions.length ? rule.actions.map(actionEditor).join('') :
          '<div class="t-sm faint">Sin acciones todavía. Agregá al menos una.</div>') +
        '</div></div>';
      bind();
    }

    function actionEditor(a, i) {
      let extra = '';
      if (a.type === 'reply') {
        extra = '<textarea class="textarea" rows="3" data-field="text" data-i="' + i + '" ' +
          'placeholder="Escribí el mensaje. Podés usar {{nombre}}, {{negocio}} y {{ausencia}}">' + esc(a.text || '') + '</textarea>';
      } else if (a.type === 'tag') {
        extra = '<select class="select" data-field="tagId" data-i="' + i + '">' +
          store.state.tags.map(function (t) {
            return '<option value="' + t.id + '"' + (a.tagId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
          }).join('') + '</select>';
      } else if (a.type === 'assign') {
        extra = '<select class="select" data-field="mode" data-i="' + i + '">' +
          '<option value="round_robin"' + (a.mode !== 'agent' ? ' selected' : '') + '>Repartir entre el equipo</option>' +
          '<option value="agent"' + (a.mode === 'agent' ? ' selected' : '') + '>Un agente fijo</option></select>' +
          (a.mode === 'agent' ? '<select class="select" data-field="agentId" data-i="' + i + '" style="margin-top:8px">' +
            store.state.agents.map(function (g) {
              return '<option value="' + g.id + '"' + (a.agentId === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
            }).join('') + '</select>' : '');
      } else if (a.type === 'stage') {
        extra = '<select class="select" data-field="stageId" data-i="' + i + '">' +
          store.state.stages.map(function (s) {
            return '<option value="' + s.id + '"' + (a.stageId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
          }).join('') + '</select>';
      } else if (a.type === 'task') {
        extra = '<input class="input" data-field="title" data-i="' + i + '" value="' + esc(a.title || '') + '" placeholder="Título de la tarea">' +
          '<input class="input" type="number" data-field="dueIn" data-i="' + i + '" value="' + (a.dueIn || 60) + '" style="margin-top:8px" placeholder="Minutos">';
      } else if (a.type === 'status') {
        extra = '<select class="select" data-field="status" data-i="' + i + '">' +
          '<option value="pending"' + (a.status === 'pending' ? ' selected' : '') + '>En espera</option>' +
          '<option value="closed"' + (a.status === 'closed' ? ' selected' : '') + '>Cerrada</option></select>';
      }

      return '<div class="card" style="background:var(--surface-3)"><div class="card-pad stack" style="gap:9px">' +
        '<div class="row-gap" style="gap:8px">' +
        '<span class="faint">' + icon((ACTIONS[a.type] || {}).icon || 'check', 15) + '</span>' +
        '<select class="select" data-field="type" data-i="' + i + '" style="width:auto;flex:1">' +
        Object.keys(ACTIONS).map(function (k) {
          return '<option value="' + k + '"' + (a.type === k ? ' selected' : '') + '>' + esc(ACTIONS[k].label) + '</option>';
        }).join('') + '</select>' +
        '<button class="btn btn-ghost btn-icon btn-sm" data-act="del-action" data-i="' + i + '">' + icon('trash', 14) + '</button>' +
        '</div>' + extra + '</div></div>';
    }

    function bind() {
      wrap.querySelector('#r-name').addEventListener('input', function () { rule.name = this.value; });
      wrap.querySelector('#r-trigger').addEventListener('change', function () {
        rule.trigger = { type: this.value };
        if (this.value === 'keyword') rule.trigger.keywords = '';
        if (this.value === 'no_reply') rule.trigger.minutes = 30;
        draw();
      });
      const kw = wrap.querySelector('#r-keywords');
      if (kw) kw.addEventListener('input', function () { rule.trigger.keywords = this.value; });
      const mn = wrap.querySelector('#r-minutes');
      if (mn) mn.addEventListener('input', function () { rule.trigger.minutes = Number(this.value) || 30; });

      dom.on(wrap, 'click', '[data-act="add-action"]', function () {
        rule.actions.push({ type: 'reply', text: '' });
        draw();
      });
      dom.on(wrap, 'click', '[data-act="del-action"]', function () {
        rule.actions.splice(Number(this.dataset.i), 1);
        draw();
      });
      dom.on(wrap, 'change', '[data-field]', function () {
        const i = Number(this.dataset.i), f = this.dataset.field;
        if (f === 'type') { rule.actions[i] = { type: this.value }; draw(); return; }
        rule.actions[i][f] = f === 'dueIn' ? Number(this.value) : this.value;
        if (f === 'mode') draw();
      });
      dom.on(wrap, 'input', 'textarea[data-field]', function () {
        rule.actions[Number(this.dataset.i)][this.dataset.field] = this.value;
      });
    }

    draw();

    ui.modal({
      title: editando ? 'Editar automatización' : 'Nueva automatización', icon: 'bolt', size: 'wide', body: wrap,
      actions: [
        { label: 'Cancelar' },
        {
          label: editando ? 'Guardar' : 'Crear regla', variant: 'primary', keepOpen: true, onClick: function (api) {
            if (!rule.name.trim()) { ui.toast('Poné un nombre a la regla', 'warn'); return false; }
            if (!rule.actions.length) { ui.toast('Agregá al menos una acción', 'warn'); return false; }
            store.commit(function (s) {
              const i = s.automations.findIndex(function (x) { return x.id === rule.id; });
              if (i >= 0) s.automations[i] = rule; else s.automations.push(rule);
            }, 'automation');
            ui.toast(editando ? 'Regla actualizada' : 'Regla creada', 'ok');
            render();
            api.close();
            return false;
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------- horario */
  function hoursDialog() {
    const w = store.state.workspace;
    const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const dias = (w.hours.days || []).slice();

    const wrap = el('div', { class: 'stack', style: { gap: '16px' } });
    wrap.innerHTML =
      '<div class="row-gap" style="gap:10px">' +
      '<button class="switch" id="h-on" role="switch" aria-checked="' + (w.hours.enabled ? 'true' : 'false') + '"></button>' +
      '<span class="t-sm strong">Aplicar horario de atención</span></div>' +
      '<div class="grid-2">' +
      '<div class="field"><label class="label">Desde</label><input class="input" type="time" id="h-from" value="' + esc(w.hours.from) + '"></div>' +
      '<div class="field"><label class="label">Hasta</label><input class="input" type="time" id="h-to" value="' + esc(w.hours.to) + '"></div>' +
      '</div>' +
      '<div class="field"><label class="label">Días de atención</label><div class="pills" id="h-days">' +
      DIAS.map(function (d, i) {
        return '<button class="pill" data-day="' + i + '" aria-pressed="' + (dias.indexOf(i) >= 0) + '">' + d + '</button>';
      }).join('') + '</div></div>' +
      '<div class="field"><label class="label">Mensaje fuera de horario</label>' +
      '<textarea class="textarea" id="h-away" rows="3">' + esc(w.awayMessage) + '</textarea>' +
      '<div class="hint">Se usa en la regla “Aviso fuera de horario”.</div></div>';

    dom.on(wrap, 'click', '[data-day]', function () {
      const d = Number(this.dataset.day), i = dias.indexOf(d);
      if (i >= 0) dias.splice(i, 1); else dias.push(d);
      this.setAttribute('aria-pressed', dias.indexOf(d) >= 0);
    });
    const sw = wrap.querySelector('#h-on');
    sw.addEventListener('click', function () {
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });

    ui.modal({
      title: 'Horario de atención', icon: 'clock', body: wrap,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Guardar', variant: 'primary', onClick: function () {
            store.commit(function (s) {
              s.workspace.hours = {
                enabled: sw.getAttribute('aria-checked') === 'true',
                from: wrap.querySelector('#h-from').value,
                to: wrap.querySelector('#h-to').value,
                days: dias.sort()
              };
              s.workspace.awayMessage = wrap.querySelector('#h-away').value;
            }, 'workspace');
            ui.toast('Horario guardado', 'ok');
          }
        }
      ]
    });
  }

  /* --------------------------------------------------------------- vista */
  NS.views = NS.views || {};
  NS.views.automatizaciones = {
    title: 'Automatizaciones',
    icon: 'bolt',
    mount: function (container) {
      root = container;
      root.className = 'view stack';
      wireOnce();
      render();
      const off = store.on('automation-run', util.throttle(render, 1500));
      return { destroy: off };
    }
  };

})(window.CRM);
