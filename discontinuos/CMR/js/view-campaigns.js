/* =========================================================================
   Nexo CRM · campañas
   Envío masivo por plantilla, con audiencia filtrada, ritmo controlado y
   seguimiento de entregas, lecturas y respuestas.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui, wa = NS.wa, chart = NS.chart;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  let root;

  const ESTADO = {
    borrador: { label: 'Borrador', color: 'neutral' },
    programada: { label: 'Programada', color: 'blue' },
    enviando: { label: 'Enviando', color: 'amber' },
    completada: { label: 'Completada', color: 'green' },
    cancelada: { label: 'Cancelada', color: 'danger' }
  };

  /* -------------------------------------------------------------- render */
  function render() {
    const cps = store.state.campaigns.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });

    root.innerHTML =
      '<div class="row-gap" style="padding:12px 16px;gap:9px;border-bottom:1px solid var(--line);flex-wrap:wrap">' +
      '<div class="stack" style="gap:0">' +
      '<span class="t-md">Campañas</span>' +
      '<span class="t-xs faint">Difusión por plantilla a segmentos de tu base</span>' +
      '</div>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new">' + icon('plus', 14) + 'Nueva campaña</button>' +
      '</div>' +
      '<div class="scroll pad" style="flex:1" id="cp-list"></div>';

    const list = root.querySelector('#cp-list');
    if (!cps.length) {
      list.innerHTML = ui.empty('megaphone', 'Todavía no hay campañas',
        'Segmentá tu base por etiqueta o etapa y enviá una plantilla aprobada a todos de una vez.',
        '<button class="btn btn-primary" data-act="new">' + icon('plus', 15) + 'Crear la primera</button>');
    } else {
      list.innerHTML = '<div class="grid-3" style="align-items:start">' + cps.map(cardHTML).join('') + '</div>';
      cps.forEach(function (cp) {
        const box = list.querySelector('[data-funnel="' + cp.id + '"]');
        if (box && cp.stats.sent) drawFunnel(box, cp);
      });
    }
  }

  function cardHTML(cp) {
    const tpl = store.template(cp.templateId);
    const est = ESTADO[cp.status] || ESTADO.borrador;
    const s = cp.stats || {};
    const audiencia = cp.status === 'borrador' ? wa.audienceOf(cp).length : (s.audience || 0);
    const progreso = audiencia ? Math.min(1, (s.sent || 0) / audiencia) : 0;
    const corriendo = wa.isRunning(cp.id);

    return '<div class="card" data-id="' + cp.id + '">' +
      '<div class="card-head">' +
      '<div class="stack" style="gap:2px;min-width:0">' +
      '<span class="t-md truncate">' + esc(cp.name) + '</span>' +
      '<span class="t-xs faint truncate">' + esc(tpl ? tpl.name : 'Sin plantilla') + '</span>' +
      '</div>' +
      '<span class="spacer"></span>' +
      '<span class="chip" data-color="' + est.color + '">' + est.label + '</span>' +
      '<button class="btn btn-ghost btn-icon btn-sm" data-act="menu" data-id="' + cp.id + '">' + icon('more', 15) + '</button>' +
      '</div>' +
      '<div class="card-pad stack" style="gap:12px">' +

      '<div class="row-gap" style="gap:12px">' +
      '<div class="stack" style="gap:1px"><span class="t-xs faint">Audiencia</span>' +
      '<span class="t-md t-num">' + util.num(audiencia) + '</span></div>' +
      '<div class="divider-v" style="height:26px"></div>' +
      '<div class="stack" style="gap:1px"><span class="t-xs faint">Enviados</span>' +
      '<span class="t-md t-num">' + util.num(s.sent || 0) + '</span></div>' +
      '<div class="divider-v" style="height:26px"></div>' +
      '<div class="stack" style="gap:1px"><span class="t-xs faint">Leídos</span>' +
      '<span class="t-md t-num">' + util.num(s.read || 0) + '</span></div>' +
      '<span class="spacer"></span>' +
      '<div class="stack" style="gap:1px;align-items:flex-end"><span class="t-xs faint">Tasa de lectura</span>' +
      '<span class="t-md t-num' + (s.sent ? ' accent' : '') + '">' + (s.sent ? util.pct(s.read / s.sent) : '—') + '</span></div>' +
      '</div>' +

      (corriendo || cp.status === 'enviando' ?
        '<div class="stack" style="gap:5px">' +
        '<div class="meter"><i style="width:' + (progreso * 100).toFixed(1) + '%"></i></div>' +
        '<span class="t-xs faint">' + util.num(s.sent || 0) + ' de ' + util.num(audiencia) + ' · ' +
        (cp.throttle || 15) + ' por minuto</span></div>' : '') +

      (s.sent ? '<div data-funnel="' + cp.id + '"></div>' : '') +

      '<div class="row-gap" style="gap:6px">' +
      (cp.status === 'borrador' || cp.status === 'programada' ?
        '<button class="btn btn-sm btn-primary" data-act="run" data-id="' + cp.id + '">' + icon('play', 13) + 'Enviar ahora</button>' : '') +
      (corriendo ? '<button class="btn btn-sm btn-danger" data-act="stop" data-id="' + cp.id + '">' + icon('pause', 13) + 'Detener</button>' : '') +
      '<button class="btn btn-sm btn-outline" data-act="edit" data-id="' + cp.id + '">' + icon('edit', 13) + 'Editar</button>' +
      '<span class="spacer"></span>' +
      '<span class="t-xs faint">' + esc(cp.scheduledAt ? util.fmtDateShort(cp.scheduledAt) : util.fmtDateShort(cp.createdAt)) + '</span>' +
      '</div>' +

      '</div></div>';
  }

  function drawFunnel(box, cp) {
    const s = cp.stats;
    chart.funnel(box, {
      steps: [
        { label: 'Enviados', value: s.sent || 0, color: 'var(--c1)' },
        { label: 'Entregados', value: s.delivered || 0, color: 'var(--c5)' },
        { label: 'Leídos', value: s.read || 0, color: 'var(--c4)' },
        { label: 'Respondieron', value: s.replied || 0, color: 'var(--c3)' }
      ]
    });
  }

  /* ------------------------------------------------------------- eventos */
  /* Delegación registrada una sola vez, al montar. */
  function wireOnce() {
    dom.on(root, 'click', '[data-act="new"]', function () { wizard(null); });
    dom.on(root, 'click', '[data-act="edit"]', function () { wizard(this.dataset.id); });
    dom.on(root, 'click', '[data-act="run"]', function () { confirmRun(this.dataset.id); });
    dom.on(root, 'click', '[data-act="stop"]', function () {
      wa.stopCampaign(this.dataset.id);
      ui.toast('Envío detenido', 'warn');
    });
    dom.on(root, 'click', '[data-act="menu"]', function () { cardMenu(this.dataset.id, this); });
  }

  function cardMenu(id, anchor) {
    const cp = store.state.campaigns.find(function (c) { return c.id === id; });
    ui.menu(anchor, [
      { icon: 'eye', label: 'Ver detalle', onClick: function () { detail(cp); } },
      { icon: 'edit', label: 'Editar', onClick: function () { wizard(id); } },
      {
        icon: 'template', label: 'Duplicar', onClick: function () {
          store.commit(function (s) {
            s.campaigns.unshift(Object.assign({}, cp, {
              id: util.uid('cp'), name: cp.name + ' (copia)', status: 'borrador',
              createdAt: Date.now(), scheduledAt: null, finishedAt: null,
              stats: { audience: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 }
            }));
          }, 'campaign');
          render();
        }
      },
      { sep: true },
      {
        icon: 'trash', label: 'Eliminar', variant: 'danger', onClick: function () {
          ui.confirm({ title: 'Eliminar campaña', message: 'Se elimina “' + cp.name + '”.', danger: true, confirmText: 'Eliminar' })
            .then(function (ok) {
              if (!ok) return;
              wa.stopCampaign(id);
              store.commit(function (s) { s.campaigns = s.campaigns.filter(function (c) { return c.id !== id; }); }, 'campaign');
              render();
            });
        }
      }
    ], { align: 'right' });
  }

  function confirmRun(id) {
    const cp = store.state.campaigns.find(function (c) { return c.id === id; });
    const aud = wa.audienceOf(cp);
    const minutos = Math.ceil(aud.length / Math.max(1, cp.throttle || 15));
    const modo = wa.mode();

    ui.confirm({
      title: 'Enviar “' + cp.name + '”',
      confirmText: 'Enviar a ' + aud.length,
      message: 'Se enviará a ' + aud.length + ' contactos a un ritmo de ' + (cp.throttle || 15) +
        ' por minuto (unos ' + minutos + ' min). ' +
        (modo === 'cloud' ? 'Los mensajes salen por la API oficial y se facturan según tu cuenta de Meta.'
          : modo === 'link' ? 'En modo enlace las campañas se registran en el CRM pero no se envían solas.'
            : 'Estás en modo demostración: se simula el envío sin salir a WhatsApp.')
    }).then(function (ok) {
      if (!ok) return;
      if (modo === 'link') {
        ui.toast('Cambiá a API oficial en Ajustes para enviar campañas reales', 'warn');
      }
      wa.runCampaign(id, function () { render(); });
      render();
    });
  }

  /* ------------------------------------------------------------- detalle */
  function detail(cp) {
    const tpl = store.template(cp.templateId);
    const s = cp.stats || {};
    const body = el('div', { class: 'stack', style: { gap: '16px' } });
    body.innerHTML =
      '<div class="kpi-grid" style="grid-template-columns:repeat(2,1fr)">' +
      kpi('Enviados', util.num(s.sent || 0)) +
      kpi('Entregados', util.num(s.delivered || 0)) +
      kpi('Leídos', util.num(s.read || 0)) +
      kpi('Fallidos', util.num(s.failed || 0)) +
      '</div>' +
      '<div class="card"><div class="card-head"><span class="t-md">Embudo del envío</span></div>' +
      '<div class="card-pad" id="dt-funnel"></div></div>' +
      '<div class="card"><div class="card-head"><span class="t-md">Mensaje</span></div>' +
      '<div class="card-pad">' + (tpl ? util.waFormat(util.interpolate(tpl.body, Object.assign({ 1: 'Nombre' }, cp.vars || {}))) : '—') + '</div></div>' +
      '<div class="card"><div class="card-head"><span class="t-md">Audiencia</span></div>' +
      '<div class="card-pad"><dl class="kv">' +
      '<dt>Etiquetas</dt><dd>' + esc((cp.audience.tags || []).map(function (t) { const x = store.tag(t); return x ? x.name : t; }).join(', ') || 'Todas') + '</dd>' +
      '<dt>Etapa</dt><dd>' + esc((store.stage(cp.audience.stage) || {}).name || 'Cualquiera') + '</dd>' +
      '<dt>Consentimiento</dt><dd>' + (cp.audience.optInOnly ? 'Sólo quienes aceptan' : 'Todos') + '</dd>' +
      '<dt>Ritmo</dt><dd>' + (cp.throttle || 15) + ' mensajes por minuto</dd>' +
      '</dl></div></div>';

    ui.drawer({ title: cp.name, subtitle: (ESTADO[cp.status] || {}).label, body: body });
    const fb = body.querySelector('#dt-funnel');
    if (s.sent) drawFunnel(fb, cp); else fb.innerHTML = '<div class="t-sm faint">Todavía no se envió.</div>';
  }

  function kpi(label, value) {
    return '<div class="kpi" style="padding:12px 13px"><div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value" style="font-size:24px">' + esc(value) + '</div></div>';
  }

  /* -------------------------------------------------------------- asistente */
  function wizard(id, preset) {
    const editando = !!id;
    const cp = editando
      ? Object.assign({}, store.state.campaigns.find(function (c) { return c.id === id; }))
      : Object.assign({
        id: util.uid('cp'), name: '', templateId: (store.state.templates.find(function (t) { return t.status === 'aprobada'; }) || {}).id,
        audience: { tags: [], stage: '', optInOnly: true, ids: null }, vars: {}, status: 'borrador',
        throttle: 15, createdAt: Date.now(), scheduledAt: null, finishedAt: null,
        stats: { audience: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 }
      }, preset || {});
    cp.audience = Object.assign({ tags: [], stage: '', optInOnly: true, ids: null }, cp.audience);
    cp.vars = Object.assign({}, cp.vars);

    let step = 0;
    const wrap = el('div', { class: 'stack', style: { gap: '16px' } });

    const modal = ui.modal({
      title: editando ? 'Editar campaña' : 'Nueva campaña', icon: 'megaphone', size: 'wide',
      body: wrap,
      actions: [
        { label: 'Atrás', keepOpen: true, onClick: function () { if (step > 0) { step--; draw(); } return false; } },
        {
          label: 'Siguiente', variant: 'primary', keepOpen: true, onClick: function (api) {
            if (step < 2) {
              if (step === 0 && !cp.name.trim()) { ui.toast('Poné un nombre a la campaña', 'warn'); return false; }
              step++; draw(); return false;
            }
            save();
            api.close();
            return false;
          }
        }
      ]
    });

    const foot = modal.root.querySelector('.modal-foot');

    function updateFoot() {
      const btns = foot.querySelectorAll('.btn');
      btns[0].style.visibility = step === 0 ? 'hidden' : 'visible';
      btns[1].textContent = step === 2 ? (editando ? 'Guardar cambios' : 'Crear campaña') : 'Siguiente';
    }

    function draw() {
      const aud = wa.audienceOf(cp);
      const tpl = store.template(cp.templateId);
      const aprobadas = store.state.templates.filter(function (t) { return t.status === 'aprobada'; });

      let inner = '<div class="onb-steps" style="padding:0 0 4px">' +
        [0, 1, 2].map(function (i) {
          return '<div class="onb-step ' + (i < step ? 'done' : i === step ? 'now' : '') + '"><i></i></div>';
        }).join('') + '</div>' +
        '<div class="t-eyebrow">Paso ' + (step + 1) + ' de 3 · ' +
        ['Mensaje', 'Audiencia', 'Envío'][step] + '</div>';

      if (step === 0) {
        inner += '<div class="field"><label class="label">Nombre de la campaña</label>' +
          '<input class="input" id="w-name" value="' + esc(cp.name) + '" placeholder="Ej: Lanzamiento temporada"></div>' +
          '<div class="field"><label class="label">Plantilla aprobada</label>' +
          (aprobadas.length ? '<select class="select" id="w-tpl">' + aprobadas.map(function (t) {
            return '<option value="' + t.id + '"' + (t.id === cp.templateId ? ' selected' : '') + '>' +
              esc(t.name) + ' · ' + esc(t.category) + '</option>';
          }).join('') + '</select>' :
            '<div class="callout" data-kind="warn">' + icon('warn', 16) +
            'No hay plantillas aprobadas. Creá una en Ajustes → Plantillas.</div>') +
          '<div class="hint">WhatsApp exige plantillas aprobadas para escribir primero fuera de la ventana de 24 horas.</div></div>' +
          '<div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">' +
          '<div class="stack" style="gap:12px;flex:1;min-width:220px">' +
          ((tpl && tpl.variables || []).map(function (v, i) {
            if (i === 0) return '<div class="field"><label class="label">{{1}} · ' + esc(v) + '</label>' +
              '<input class="input" value="Nombre del contacto" disabled>' +
              '<div class="hint">Se completa automáticamente con el nombre de cada persona.</div></div>';
            return '<div class="field"><label class="label">{{' + (i + 1) + '}} · ' + esc(v) + '</label>' +
              '<input class="input" data-var="' + (i + 1) + '" value="' + esc(cp.vars[i + 1] || '') + '"></div>';
          }).join('')) +
          '</div>' + previewHTML(tpl, cp) + '</div>';
      }

      if (step === 1) {
        inner += '<div class="field"><label class="label">Filtrar por etiquetas</label>' +
          '<div class="pills" id="w-tags">' + store.state.tags.map(function (t) {
            return '<button class="pill" data-tag="' + t.id + '" aria-pressed="' +
              (cp.audience.tags.indexOf(t.id) >= 0) + '"><i class="dot" style="color:var(--' +
              ({ blue: 'c1', magenta: 'c2', amber: 'c3', green: 'c4', violet: 'c5' }[t.color] || 'c-neutral') + ')"></i>' +
              esc(t.name) + '</button>';
          }).join('') + '</div>' +
          '<div class="hint">Se incluyen sólo los contactos que tengan <b>todas</b> las etiquetas elegidas.</div></div>' +

          '<div class="field"><label class="label">Etapa del embudo</label>' +
          '<select class="select" id="w-stage"><option value="">Cualquiera</option>' +
          store.state.stages.map(function (s) {
            return '<option value="' + s.id + '"' + (cp.audience.stage === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
          }).join('') + '</select></div>' +

          '<div class="row-gap" style="gap:10px">' +
          '<button class="switch" id="w-optin" role="switch" aria-checked="' + (cp.audience.optInOnly ? 'true' : 'false') + '"></button>' +
          '<div class="stack" style="gap:1px"><span class="t-sm strong">Sólo quienes aceptan promociones</span>' +
          '<span class="t-xs faint">Recomendado. Reduce bloqueos y protege la calidad de tu número.</span></div>' +
          '</div>' +

          '<div class="callout" data-kind="' + (aud.length ? 'ok' : 'warn') + '">' + icon(aud.length ? 'check' : 'warn', 16) +
          '<div><b>' + util.num(aud.length) + ' contactos</b> reciben esta campaña.' +
          (aud.length ? ' Ejemplos: ' + esc(aud.slice(0, 4).map(function (c) { return c.name; }).join(', ')) +
            (aud.length > 4 ? ' y ' + (aud.length - 4) + ' más.' : '') : ' Ajustá los filtros para incluir a alguien.') +
          '</div></div>';
      }

      if (step === 2) {
        const minutos = Math.ceil(aud.length / Math.max(1, cp.throttle));
        inner += '<div class="grid-2">' +
          '<div class="field"><label class="label">Ritmo de envío</label>' +
          '<input class="input" type="number" id="w-throttle" min="1" max="60" value="' + cp.throttle + '">' +
          '<div class="hint">Mensajes por minuto. Un ritmo bajo protege la reputación del número.</div></div>' +
          '<div class="field"><label class="label">Programar para</label>' +
          '<input class="input" type="datetime-local" id="w-sched" value="' + (cp.scheduledAt ? localDT(cp.scheduledAt) : '') + '">' +
          '<div class="hint">Dejalo vacío para enviar manualmente.</div></div>' +
          '</div>' +
          '<div class="callout" data-kind="info">' + icon('info', 16) +
          '<div>Resumen: <b>' + util.num(aud.length) + '</b> destinatarios a <b>' + cp.throttle +
          '</b> por minuto ≈ <b>' + minutos + ' min</b> de envío. ' +
          (wa.mode() === 'cloud' ? 'Saldrá por la API oficial.' : 'Modo ' + wa.modeLabel().toLowerCase() + '.') + '</div></div>' +
          previewHTML(store.template(cp.templateId), cp, true);
      }

      wrap.innerHTML = inner;
      bind();
      updateFoot();
    }

    function previewHTML(tpl, cp2, centered) {
      if (!tpl) return '';
      const preview = util.interpolate(tpl.body, Object.assign({ 1: 'Camila' }, cp2.vars));
      return '<div class="phone-preview"' + (centered ? ' style="margin:0 auto"' : '') + '>' +
        '<div class="t-xs faint" style="text-align:center">Así lo recibe el cliente</div>' +
        '<div class="phone-screen"><div class="preview-bubble">' +
        (tpl.header ? '<div class="pb-head">' + esc(tpl.header) + '</div>' : '') +
        util.waFormat(preview) +
        (tpl.footer ? '<div class="pb-foot">' + esc(tpl.footer) + '</div>' : '') +
        (tpl.buttons || []).map(function (b) { return '<div class="preview-btn">' + esc(b.text) + '</div>'; }).join('') +
        '</div></div></div>';
    }

    function bind() {
      const name = wrap.querySelector('#w-name');
      if (name) name.addEventListener('input', function () { cp.name = this.value; });
      const tplSel = wrap.querySelector('#w-tpl');
      if (tplSel) tplSel.addEventListener('change', function () { cp.templateId = this.value; cp.vars = {}; draw(); });
      dom.on(wrap, 'input', '[data-var]', function () { cp.vars[this.dataset.var] = this.value; });
      dom.on(wrap, 'change', '[data-var]', function () { draw(); });
      dom.on(wrap, 'click', '[data-tag]', function () {
        const t = this.dataset.tag, i = cp.audience.tags.indexOf(t);
        if (i >= 0) cp.audience.tags.splice(i, 1); else cp.audience.tags.push(t);
        draw();
      });
      const stage = wrap.querySelector('#w-stage');
      if (stage) stage.addEventListener('change', function () { cp.audience.stage = this.value; draw(); });
      const optin = wrap.querySelector('#w-optin');
      if (optin) optin.addEventListener('click', function () {
        cp.audience.optInOnly = !cp.audience.optInOnly;
        draw();
      });
      const th = wrap.querySelector('#w-throttle');
      if (th) th.addEventListener('input', function () { cp.throttle = util.clamp(Number(this.value) || 15, 1, 60); });
      const sch = wrap.querySelector('#w-sched');
      if (sch) sch.addEventListener('change', function () {
        cp.scheduledAt = this.value ? new Date(this.value).getTime() : null;
        cp.status = this.value ? 'programada' : 'borrador';
      });
    }

    function save() {
      store.commit(function (s) {
        const i = s.campaigns.findIndex(function (c) { return c.id === cp.id; });
        if (i >= 0) s.campaigns[i] = cp; else s.campaigns.unshift(cp);
      }, 'campaign');
      ui.toast(editando ? 'Campaña actualizada' : 'Campaña creada', 'ok');
      render();
    }

    draw();
  }

  function localDT(ts) {
    const d = new Date(ts), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* --------------------------------------------------------------- vista */
  NS.views = NS.views || {};
  NS.views.campanas = {
    title: 'Campañas',
    icon: 'megaphone',
    mount: function (container) {
      root = container;
      root.className = 'view stack';
      wireOnce();
      render();
      const off = store.on('campaign', util.throttle(render, 600));
      return { destroy: off };
    }
  };

  NS.campaigns = {
    open: function () { NS.app.go('campanas'); },
    newFromContacts: function (ids) {
      NS.app.go('campanas');
      setTimeout(function () {
        wizard(null, { name: 'Campaña a ' + ids.length + ' contactos', audience: { tags: [], stage: '', optInOnly: true, ids: ids } });
      }, 60);
    }
  };

})(window.CRM);
