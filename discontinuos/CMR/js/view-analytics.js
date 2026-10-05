/* =========================================================================
   Nexo CRM · métricas
   Tablero de rendimiento: volumen, tiempos de respuesta, embudo, equipo y
   franjas horarias. Cada gráfico tiene su equivalente en tabla.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui, chart = NS.chart;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  const state = { days: 30, tables: {} };
  let root;

  const DAY = 86400000;

  /* ------------------------------------------------------------- cálculo */
  function dailySeries(days) {
    const st = store.state;
    const hoy = util.startOfDay(new Date()).getTime();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      out.push({
        date: hoy - i * DAY, conversaciones: 0, entrantes: 0, salientes: 0,
        resueltas: 0, nuevos: 0, frt: []
      });
    }
    const idx = function (ts) {
      const d = util.startOfDay(ts).getTime();
      const i = days - 1 - Math.round((hoy - d) / DAY);
      return (i >= 0 && i < days) ? i : -1;
    };

    st.conversations.forEach(function (c) {
      const iC = idx(c.createdAt);
      if (iC >= 0) { out[iC].conversaciones++; out[iC].nuevos++; }
      if (c.closedAt) { const iX = idx(c.closedAt); if (iX >= 0) out[iX].resueltas++; }
      if (c.firstInboundAt && c.firstResponseAt) {
        const iF = idx(c.firstResponseAt);
        if (iF >= 0) out[iF].frt.push((c.firstResponseAt - c.firstInboundAt) / 60000);
      }
      c.messages.forEach(function (m) {
        const i = idx(m.at);
        if (i < 0) return;
        if (m.dir === 'in') out[i].entrantes++;
        else if (m.dir === 'out') out[i].salientes++;
      });
    });

    /* el espacio de demostración suma su historia sintética para que el
       tablero tenga profundidad desde el primer día */
    if (st.meta.demo && Array.isArray(st.meta.history)) {
      st.meta.history.forEach(function (h) {
        const i = idx(h.date);
        if (i < 0) return;
        out[i].conversaciones += h.conversaciones;
        out[i].entrantes += h.entrantes;
        out[i].salientes += h.salientes;
        out[i].resueltas += h.resueltas;
        out[i].nuevos += h.nuevos;
        out[i].frt.push(h.frt);
      });
    }

    out.forEach(function (d) {
      d.frtMediana = d.frt.length ? util.median(d.frt) : null;
    });
    return out;
  }

  function periodTotals(serie) {
    return {
      conversaciones: util.sum(serie, function (d) { return d.conversaciones; }),
      entrantes: util.sum(serie, function (d) { return d.entrantes; }),
      salientes: util.sum(serie, function (d) { return d.salientes; }),
      resueltas: util.sum(serie, function (d) { return d.resueltas; }),
      frt: util.median(serie.filter(function (d) { return d.frtMediana != null; }).map(function (d) { return d.frtMediana; }))
    };
  }

  function readRate() {
    let out = 0, leidos = 0;
    store.state.conversations.forEach(function (c) {
      c.messages.forEach(function (m) {
        if (m.dir !== 'out') return;
        out++;
        if (m.status === 'read') leidos++;
      });
    });
    return out ? leidos / out : 0;
  }

  function wonInPeriod(days) {
    const desde = Date.now() - days * DAY;
    return store.state.deals.filter(function (d) {
      const s = store.stage(d.stageId);
      return s && s.kind === 'won' && (d.closedAt || d.updatedAt) >= desde;
    });
  }

  function agentStats() {
    const st = store.state;
    return st.agents.filter(function (a) { return a.active; }).map(function (a) {
      const convs = st.conversations.filter(function (c) { return c.assignedTo === a.id; });
      const mensajes = util.sum(st.conversations, function (c) {
        return c.messages.filter(function (m) { return m.dir === 'out' && m.author === a.id; }).length;
      });
      const frts = convs.filter(function (c) { return c.firstInboundAt && c.firstResponseAt; })
        .map(function (c) { return (c.firstResponseAt - c.firstInboundAt) / 60000; });
      const ganado = util.sum(st.deals.filter(function (d) {
        const s = store.stage(d.stageId);
        return d.ownerId === a.id && s && s.kind === 'won';
      }), function (d) { return d.value; });
      return {
        agent: a, conversaciones: convs.length, mensajes: mensajes,
        cerradas: convs.filter(function (c) { return c.status === 'closed'; }).length,
        frt: frts.length ? util.median(frts) : null, ganado: ganado
      };
    }).sort(function (a, b) { return b.conversaciones - a.conversaciones; });
  }

  function heatMatrix() {
    const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const m = dias.map(function () { return new Array(24).fill(0); });
    store.state.conversations.forEach(function (c) {
      c.messages.forEach(function (msg) {
        if (msg.dir !== 'in') return;
        const d = new Date(msg.at);
        const row = (d.getDay() + 6) % 7;
        m[row][d.getHours()]++;
      });
    });
    /* refuerzo para la demostración: distribución típica de un comercio */
    if (store.state.meta.demo) {
      const r = NS.seed.rng(4242);
      for (let i = 0; i < 7; i++) for (let h = 0; h < 24; h++) {
        const pico = h >= 9 && h <= 20 ? 1 : 0.08;
        const finde = i >= 5 ? 0.45 : 1;
        m[i][h] += Math.round(r() * 22 * pico * finde);
      }
    }
    return { rows: dias, cols: Array.from({ length: 24 }, function (_, h) { return String(h).padStart(2, '0'); }), values: m };
  }

  function tagStats() {
    const counts = {};
    store.state.contacts.forEach(function (c) {
      c.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    return Object.keys(counts).map(function (id) {
      const t = store.tag(id);
      return { label: t ? t.name : id, value: counts[id], color: tagColor(t) };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
  }

  function tagColor(t) {
    return {
      blue: 'var(--c1)', magenta: 'var(--c2)', amber: 'var(--c3)',
      green: 'var(--c4)', violet: 'var(--c5)'
    }[(t || {}).color] || 'var(--c-neutral)';
  }

  /* -------------------------------------------------------------- render */
  function render() {
    const serie = dailySeries(state.days);
    const prev = dailySeries(state.days * 2).slice(0, state.days);
    const tot = periodTotals(serie), totPrev = periodTotals(prev);
    const sla = store.state.settings.sla.firstResponse;
    const ganados = wonInPeriod(state.days);
    const lectura = readRate();

    root.innerHTML =
      '<div class="row-gap" style="padding:12px 16px;gap:9px;border-bottom:1px solid var(--line);flex-wrap:wrap">' +
      '<div class="stack" style="gap:0">' +
      '<span class="t-md">Rendimiento</span>' +
      '<span class="t-xs faint">Últimos ' + state.days + ' días · comparado con el período anterior</span>' +
      '</div>' +
      '<span class="spacer"></span>' +
      '<div class="segmented" id="an-period">' +
      [[7, '7 días'], [30, '30 días'], [90, '90 días']].map(function (p) {
        return '<button data-d="' + p[0] + '" aria-selected="' + (state.days === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<button class="btn btn-sm btn-outline" data-act="export">' + icon('download', 14) + 'Exportar</button>' +
      '</div>' +

      '<div class="scroll pad" style="flex:1">' +

      '<div class="kpi-grid">' +
      kpi('Conversaciones', util.num(tot.conversaciones), delta(tot.conversaciones, totPrev.conversaciones), 'spark-conv') +
      kpi('Primera respuesta', util.dur(tot.frt), delta(tot.frt, totPrev.frt, true), null,
        tot.frt <= sla ? 'Dentro del objetivo de ' + sla + ' min' : 'Objetivo: ' + sla + ' min') +
      kpi('Resueltas', util.num(tot.resueltas), delta(tot.resueltas, totPrev.resueltas), null,
        tot.conversaciones ? util.pct(tot.resueltas / tot.conversaciones) + ' del total' : '') +
      kpi('Mensajes enviados', util.num(tot.salientes), delta(tot.salientes, totPrev.salientes), 'spark-out') +
      kpi('Tasa de lectura', util.pct(lectura), null, null, 'Sobre los mensajes salientes') +
      kpi('Ganado', util.moneyCompact(util.sum(ganados, function (d) { return d.value; })), null, null,
        ganados.length + ' negocio' + (ganados.length === 1 ? '' : 's')) +
      '</div>' +

      '<div class="grid-3" style="margin-top:14px">' +

      card('vol', 'Volumen de mensajes', 'Entrantes y salientes por día',
        chart.legend([{ name: 'Entrantes', color: 'var(--c1)' }, { name: 'Salientes', color: 'var(--c4)' }])) +

      card('frt', 'Tiempo de primera respuesta', 'Mediana diaria en minutos · objetivo ' + sla + ' min') +

      '</div>' +

      '<div class="grid-3" style="margin-top:14px">' +
      card('funnel', 'Embudo de ventas', 'Negocios por etapa') +
      card('agents', 'Equipo', 'Conversaciones atendidas por agente') +
      '</div>' +

      '<div class="grid-3" style="margin-top:14px">' +
      card('heat', 'Cuándo escriben tus clientes', 'Mensajes entrantes por día y hora') +
      card('tags', 'Etiquetas más usadas', 'Distribución de la base de contactos') +
      '</div>' +

      '<div class="card" style="margin-top:14px"><div class="card-head">' +
      '<span class="t-md">Actividad reciente</span></div>' +
      '<div class="stack" style="padding:6px">' + activityHTML() + '</div></div>' +

      '</div>';

    drawAll(serie);
  }

  function card(key, title, sub, extraHead) {
    return '<div class="chart-card" data-card="' + key + '">' +
      '<div class="chart-head">' +
      '<div class="stack" style="gap:1px;min-width:0">' +
      '<span class="chart-title">' + esc(title) + '</span>' +
      '<span class="chart-sub">' + esc(sub) + '</span>' +
      '</div><span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-sm" data-act="table" data-key="' + key + '">' +
      (state.tables[key] ? icon('chart', 13) + 'Gráfico' : icon('list', 13) + 'Datos') + '</button>' +
      '</div>' +
      (extraHead && !state.tables[key] ? extraHead : '') +
      '<div data-plot="' + key + '"></div>' +
      '</div>';
  }

  function kpi(label, value, deltaHTML, sparkId, foot) {
    return '<div class="kpi">' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + esc(value) + '</div>' +
      '<div class="row-gap" style="gap:8px;margin-top:2px">' +
      (deltaHTML || '') +
      (foot ? '<span class="t-xs faint truncate">' + esc(foot) + '</span>' : '') +
      '</div>' +
      (sparkId ? '<div data-spark="' + sparkId + '" style="margin-top:8px"></div>' : '') +
      '</div>';
  }

  function delta(now, before, inverso) {
    if (!before || before === now) return '<span class="kpi-delta" data-dir="flat">—</span>';
    const pct = (now - before) / before;
    const up = pct > 0;
    const bueno = inverso ? !up : up;
    return '<span class="kpi-delta" data-dir="' + (bueno ? 'up' : 'down') + '">' +
      icon(up ? 'arrowUp' : 'arrowDown', 12) + util.pct(Math.abs(pct)) + '</span>';
  }

  function activityHTML() {
    const acts = store.state.activity.slice(0, 8);
    if (!acts.length) return '<div class="t-sm faint" style="padding:12px">Sin actividad registrada.</div>';
    return acts.map(function (a) {
      const ag = a.actor ? store.agent(a.actor) : null;
      return '<div class="mini-item" style="cursor:default">' +
        (ag ? ui.avatarHTML(ag.name, { size: 'sm', seed: ag.id }) : '<span class="faint">' + icon('bolt', 15) + '</span>') +
        '<div class="stack" style="gap:1px;min-width:0;flex:1">' +
        '<span class="t-sm truncate"><b>' + esc(ag ? ag.name : 'Sistema') + '</b> ' + esc(a.text) + '</span>' +
        '<span class="t-xs faint">' + esc(util.relTime(a.at)) + '</span>' +
        '</div></div>';
    }).join('');
  }

  /* ------------------------------------------------------------ dibujado */
  function drawAll(serie) {
    const labels = serie.map(function (d) { return util.fmtDateShort(d.date); });
    const sla = store.state.settings.sla.firstResponse;

    plot('vol', function (box) {
      chart.lines(box, {
        height: 200, area: true, labels: labels, title: 'Volumen de mensajes',
        series: [
          { name: 'Entrantes', values: serie.map(function (d) { return d.entrantes; }), color: 'var(--c1)' },
          { name: 'Salientes', values: serie.map(function (d) { return d.salientes; }), color: 'var(--c4)' }
        ]
      });
    }, function () {
      return chart.dataTable(['Día', 'Entrantes', 'Salientes', 'Conversaciones'],
        serie.map(function (d) {
          return [util.fmtDateShort(d.date), util.num(d.entrantes), util.num(d.salientes), util.num(d.conversaciones)];
        }));
    });

    plot('frt', function (box) {
      chart.bars(box, {
        height: 200, valueLabel: 'Minutos', title: 'Primera respuesta',
        format: function (v) { return util.num(v) + 'm'; },
        items: serie.map(function (d) {
          const v = d.frtMediana == null ? 0 : Math.round(d.frtMediana);
          return {
            label: util.fmtDateShort(d.date), value: v,
            color: v > sla ? 'var(--c3)' : 'var(--c4)',
            sub: v > sla ? 'Por encima del objetivo' : 'Dentro del objetivo'
          };
        })
      });
      box.insertAdjacentHTML('beforeend', chart.legend([
        { name: 'Dentro del objetivo', color: 'var(--c4)' },
        { name: 'Por encima de ' + sla + ' min', color: 'var(--c3)' }
      ]));
    }, function () {
      return chart.dataTable(['Día', 'Mediana (min)'],
        serie.map(function (d) { return [util.fmtDateShort(d.date), d.frtMediana == null ? '—' : util.num(d.frtMediana)]; }));
    });

    plot('funnel', function (box) {
      const stages = store.state.stages.slice().sort(function (a, b) { return a.order - b.order; })
        .filter(function (s) { return s.kind !== 'lost'; });
      chart.funnel(box, {
        conversion: false,
        steps: stages.map(function (s, i) {
          const ds = store.state.deals.filter(function (d) { return d.stageId === s.id; });
          return {
            label: s.name, value: ds.length, color: chart.series[i % chart.series.length],
            sub: util.moneyCompact(util.sum(ds, function (d) { return d.value; }))
          };
        })
      });
    }, function () {
      return chart.dataTable(['Etapa', 'Negocios', 'Valor'],
        store.state.stages.slice().sort(function (a, b) { return a.order - b.order; }).map(function (s) {
          const ds = store.state.deals.filter(function (d) { return d.stageId === s.id; });
          return [s.name, util.num(ds.length), util.money(util.sum(ds, function (d) { return d.value; }))];
        }));
    });

    plot('agents', function (box) {
      const stats = agentStats();
      chart.ranking(box, {
        items: stats.map(function (s, i) {
          return {
            label: s.agent.name, value: s.conversaciones, color: chart.series[i % chart.series.length],
            sub: util.num(s.mensajes) + ' mensajes · primera respuesta ' + util.dur(s.frt)
          };
        })
      });
    }, function () {
      return chart.dataTable(['Agente', 'Conversaciones', 'Mensajes', '1ª respuesta', 'Ganado'],
        agentStats().map(function (s) {
          return [s.agent.name, util.num(s.conversaciones), util.num(s.mensajes), util.dur(s.frt), util.money(s.ganado)];
        }));
    });

    plot('heat', function (box) {
      const m = heatMatrix();
      chart.heat(box, { rows: m.rows, cols: m.cols, values: m.values, everyCol: 3, valueLabel: 'Mensajes entrantes' });
      box.insertAdjacentHTML('beforeend',
        '<div class="row-gap" style="gap:7px;margin-top:9px;justify-content:flex-end">' +
        '<span class="t-xs faint">Menos</span>' +
        [0.08, 0.3, 0.55, 0.78, 0.95].map(function (o) {
          return '<i style="width:13px;height:11px;border-radius:3px;background:var(--accent);opacity:' + o + '"></i>';
        }).join('') +
        '<span class="t-xs faint">Más</span></div>');
    }, function () {
      const m = heatMatrix();
      return chart.dataTable(['Día'].concat(m.cols.filter(function (_, i) { return i % 3 === 0; })),
        m.rows.map(function (r, i) {
          return [r].concat(m.values[i].filter(function (_, j) { return j % 3 === 0; }).map(function (v) { return util.num(v); }));
        }));
    });

    plot('tags', function (box) {
      const items = tagStats();
      if (!items.length) { box.innerHTML = '<div class="t-sm faint">Sin etiquetas asignadas todavía.</div>'; return; }
      chart.ranking(box, { items: items, format: function (v) { return util.num(v) + ' contactos'; } });
    }, function () {
      return chart.dataTable(['Etiqueta', 'Contactos'], tagStats().map(function (t) { return [t.label, util.num(t.value)]; }));
    });

    /* minigráficos de las tarjetas */
    const sc = root.querySelector('[data-spark="spark-conv"]');
    if (sc) chart.spark(sc, serie.map(function (d) { return d.conversaciones; }), 'var(--accent)');
    const so = root.querySelector('[data-spark="spark-out"]');
    if (so) chart.spark(so, serie.map(function (d) { return d.salientes; }), 'var(--c4)');
  }

  function plot(key, drawFn, tableFn) {
    const box = root.querySelector('[data-plot="' + key + '"]');
    if (!box) return;
    if (state.tables[key]) box.innerHTML = tableFn();
    else drawFn(box);
  }

  /* ------------------------------------------------------------- eventos */
  /* Delegación registrada una sola vez, al montar. */
  function wireOnce() {
    dom.on(root, 'click', '#an-period button', function () {
      state.days = Number(this.dataset.d);
      render();
    });
    dom.on(root, 'click', '[data-act="table"]', function () {
      const k = this.dataset.key;
      state.tables[k] = !state.tables[k];
      render();
    });
    dom.on(root, 'click', '[data-act="export"]', function () {
      const rows = dailySeries(state.days).map(function (d) {
        return {
          fecha: new Date(d.date).toISOString().slice(0, 10),
          conversaciones: d.conversaciones, entrantes: d.entrantes, salientes: d.salientes,
          resueltas: d.resueltas, primera_respuesta_min: d.frtMediana == null ? '' : Math.round(d.frtMediana)
        };
      });
      util.download('metricas-' + state.days + 'd.csv', util.toCSV(rows), 'text/csv;charset=utf-8');
      ui.toast('Métricas exportadas', 'ok');
    });
  }

  /* --------------------------------------------------------------- vista */
  NS.views = NS.views || {};
  NS.views.metricas = {
    title: 'Métricas',
    icon: 'chart',
    mount: function (container) {
      root = container;
      root.className = 'view stack';
      wireOnce();
      render();
      return { destroy: function () { chart.hideTip(); } };
    }
  };

})(window.CRM);
