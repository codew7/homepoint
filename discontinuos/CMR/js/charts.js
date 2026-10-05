/* =========================================================================
   Nexo CRM · gráficos
   SVG a mano: marcas finas, grilla discreta, leyenda siempre presente con dos
   o más series, etiquetas directas selectivas y capa de hover por defecto.
   Paleta categórica de orden fijo (validada para daltonismo), nunca ciclada.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, esc = util.esc;

  /* orden fijo: identidad → color, nunca por ranking */
  const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];

  const chart = NS.chart = { series: SERIES };

  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* --------------------------------------------------------- información */
  let tip = null;
  function tipNode() {
    if (!tip) {
      tip = dom.el('div', { class: 'chart-tip' });
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(html, x, y) {
    const t = tipNode();
    t.innerHTML = html;
    t.classList.add('on');
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = util.clamp(x + 14, 8, innerWidth - w - 8) + 'px';
    t.style.top = util.clamp(y - h - 12, 8, innerHeight - h - 8) + 'px';
  }
  function hideTip() { if (tip) tip.classList.remove('on'); }
  chart.hideTip = hideTip;

  /* redibuja cuando cambia el ancho del contenedor */
  function responsive(container, draw) {
    let w = 0, raf = 0;
    const run = function () {
      const nw = container.clientWidth;
      if (nw && Math.abs(nw - w) > 2) { w = nw; container.innerHTML = ''; draw(container, nw); }
    };
    run();
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(run);
      });
      ro.observe(container);
      container._chartRO && container._chartRO.disconnect();
      container._chartRO = ro;
    } else {
      window.addEventListener('resize', util.debounce(run, 150));
    }
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * mag;
  }

  chart.legend = function (items) {
    return '<div class="legend">' + items.map(function (i) {
      return '<span class="legend-item"><i class="legend-swatch" style="background:' + i.color + '"></i>' + esc(i.name) + '</span>';
    }).join('') + '</div>';
  };

  /* ------------------------------------------------------- líneas / área */
  /* spec: {series:[{name, values:[]}], labels:[], height, format, area:bool} */
  chart.lines = function (container, spec) {
    responsive(container, function (root, W) {
      const H = spec.height || 190;
      const padL = 38, padR = 12, padT = 12, padB = 24;
      const iw = Math.max(10, W - padL - padR), ih = H - padT - padB;
      const n = spec.labels.length;
      const fmt = spec.format || function (v) { return util.num(v); };

      let max = 0;
      spec.series.forEach(function (se) { se.values.forEach(function (v) { max = Math.max(max, v); }); });
      max = niceMax(max * 1.12);

      const x = function (i) { return padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); };
      const y = function (v) { return padT + ih - (v / max) * ih; };

      const svg = s('svg', { class: 'chart-svg', height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
      svg.setAttribute('aria-label', spec.title || 'Gráfico de líneas');

      /* grilla y eje Y: recesivos, nunca compiten con los datos */
      const ticks = 4;
      for (let t = 0; t <= ticks; t++) {
        const v = (max / ticks) * t, yy = y(v);
        svg.appendChild(s('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy }));
        const label = s('text', { class: 'axis-text', x: padL - 7, y: yy + 3.5, 'text-anchor': 'end' });
        label.textContent = t === 0 ? '0' : fmt(v);
        svg.appendChild(label);
      }

      /* eje X: primera, media y última etiqueta, para no saturar */
      [0, Math.floor((n - 1) / 2), n - 1].filter(function (v, i, a) { return a.indexOf(v) === i && v >= 0; })
        .forEach(function (i) {
          const t = s('text', {
            class: 'axis-text', x: x(i), y: H - 6,
            'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
          });
          t.textContent = spec.labels[i];
          svg.appendChild(t);
        });

      spec.series.forEach(function (se, si) {
        const color = se.color || SERIES[si];
        const pts = se.values.map(function (v, i) { return [x(i), y(v)]; });
        const d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');

        if (spec.area) {
          const gid = 'g' + Math.random().toString(36).slice(2, 8);
          const defs = s('defs');
          const lg = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
          lg.appendChild(s('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': si === 0 ? .26 : .12 }));
          lg.appendChild(s('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
          defs.appendChild(lg); svg.appendChild(defs);
          svg.appendChild(s('path', {
            d: d + ' L' + x(n - 1) + ' ' + (padT + ih) + ' L' + x(0) + ' ' + (padT + ih) + ' Z',
            fill: 'url(#' + gid + ')'
          }));
        }
        /* trazo de 2px: fino pero legible */
        svg.appendChild(s('path', {
          d: d, fill: 'none', stroke: color, 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
      });

      /* capa de hover: cruz + puntos + información de todas las series */
      const cross = s('line', { class: 'axis-line', y1: padT, y2: padT + ih, opacity: 0, stroke: 'var(--line-3)' });
      svg.appendChild(cross);
      const dots = spec.series.map(function (se, si) {
        const c = s('circle', { r: 4.5, fill: 'var(--surface-1)', stroke: se.color || SERIES[si], 'stroke-width': 2.5, opacity: 0 });
        svg.appendChild(c); return c;
      });

      const hit = s('rect', { x: padL, y: padT, width: iw, height: ih, fill: 'transparent' });
      svg.appendChild(hit);

      hit.addEventListener('pointermove', function (e) {
        const rect = svg.getBoundingClientRect();
        const rel = (e.clientX - rect.left - padL) / iw;
        const i = util.clamp(Math.round(rel * (n - 1)), 0, n - 1);
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
        dots.forEach(function (c, si) {
          c.setAttribute('cx', x(i)); c.setAttribute('cy', y(spec.series[si].values[i])); c.setAttribute('opacity', 1);
        });
        showTip(
          '<div class="t-xs faint" style="margin-bottom:5px">' + esc(spec.labels[i]) + '</div>' +
          spec.series.map(function (se, si) {
            return '<div class="chart-tip-row"><span class="legend-item"><i class="legend-swatch" style="background:' +
              (se.color || SERIES[si]) + '"></i>' + esc(se.name) + '</span><b class="t-num">' + fmt(se.values[i]) + '</b></div>';
          }).join(''), e.clientX, e.clientY);
      });
      hit.addEventListener('pointerleave', function () {
        cross.setAttribute('opacity', 0);
        dots.forEach(function (c) { c.setAttribute('opacity', 0); });
        hideTip();
      });

      root.appendChild(svg);
    });
  };

  /* ------------------------------------------------------ barras verticales */
  chart.bars = function (container, spec) {
    responsive(container, function (root, W) {
      const H = spec.height || 170;
      const padL = 34, padR = 8, padT = 12, padB = 26;
      const iw = Math.max(10, W - padL - padR), ih = H - padT - padB;
      const n = spec.items.length;
      const fmt = spec.format || function (v) { return util.num(v); };
      let max = niceMax(Math.max.apply(null, spec.items.map(function (i) { return i.value; }).concat([1])) * 1.1);

      /* 2px de separación con la superficie entre barras adyacentes */
      const slot = iw / Math.max(1, n);
      const bw = Math.max(3, Math.min(spec.maxBarWidth || 26, slot - 2));

      const svg = s('svg', { class: 'chart-svg', height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
      svg.setAttribute('aria-label', spec.title || 'Gráfico de barras');

      for (let t = 0; t <= 3; t++) {
        const v = (max / 3) * t, yy = padT + ih - (v / max) * ih;
        svg.appendChild(s('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy }));
        const lb = s('text', { class: 'axis-text', x: padL - 7, y: yy + 3.5, 'text-anchor': 'end' });
        lb.textContent = t === 0 ? '0' : fmt(v);
        svg.appendChild(lb);
      }

      spec.items.forEach(function (it, i) {
        const h = Math.max(2, (it.value / max) * ih);
        const bx = padL + slot * i + (slot - bw) / 2;
        const by = padT + ih - h;
        const color = it.color || spec.color || 'var(--c1)';
        /* extremo redondeado de 4px, anclado a la línea base */
        const g = s('g');
        const p = s('path', {
          class: 'bar-mark',
          d: 'M' + bx + ' ' + (padT + ih) + ' L' + bx + ' ' + (by + 4) +
            ' Q' + bx + ' ' + by + ' ' + (bx + 4) + ' ' + by +
            ' L' + (bx + bw - 4) + ' ' + by +
            ' Q' + (bx + bw) + ' ' + by + ' ' + (bx + bw) + ' ' + (by + 4) +
            ' L' + (bx + bw) + ' ' + (padT + ih) + ' Z',
          fill: color, opacity: it.dim ? .38 : 1
        });
        const hit = s('rect', { class: 'bar-hit', x: bx - 1, y: padT, width: bw + 2, height: ih });
        hit.addEventListener('pointerenter', function (e) {
          p.setAttribute('opacity', 1);
          showTip('<div class="t-xs faint" style="margin-bottom:4px">' + esc(it.label) + '</div>' +
            '<div class="chart-tip-row"><span>' + esc(spec.valueLabel || 'Valor') + '</span><b class="t-num">' + fmt(it.value) + '</b></div>' +
            (it.sub ? '<div class="t-xs faint" style="margin-top:4px">' + esc(it.sub) + '</div>' : ''),
            e.clientX, e.clientY);
        });
        hit.addEventListener('pointermove', function (e) { showTip(tipNode().innerHTML, e.clientX, e.clientY); });
        hit.addEventListener('pointerleave', function () { p.setAttribute('opacity', it.dim ? .38 : 1); hideTip(); });
        g.appendChild(hit); g.appendChild(p);
        svg.appendChild(g);

        if (spec.everyLabel ? i % spec.everyLabel === 0 : (n <= 12 || i % Math.ceil(n / 8) === 0)) {
          const t = s('text', { class: 'axis-text', x: bx + bw / 2, y: H - 8, 'text-anchor': 'middle' });
          t.textContent = it.label;
          svg.appendChild(t);
        }
      });

      root.appendChild(svg);
    });
  };

  /* --------------------------------------------------- barras horizontales */
  /* Para rankings: la etiqueta directa evita depender del color.           */
  chart.ranking = function (container, spec) {
    const fmt = spec.format || function (v) { return util.num(v); };
    const max = Math.max.apply(null, spec.items.map(function (i) { return i.value; }).concat([1]));
    container.innerHTML = '<div class="stack" style="gap:11px">' + spec.items.map(function (it, i) {
      const pct = Math.max(1.5, (it.value / max) * 100);
      return '<div class="stack" style="gap:5px">' +
        '<div class="row" style="gap:8px;justify-content:space-between">' +
        '<span class="t-sm truncate">' + esc(it.label) + '</span>' +
        '<span class="t-sm t-num strong">' + fmt(it.value) + '</span>' +
        '</div>' +
        '<div class="meter" style="height:8px"><i style="width:' + pct + '%;background:' +
        (it.color || SERIES[i % SERIES.length]) + '"></i></div>' +
        (it.sub ? '<div class="t-xs faint">' + esc(it.sub) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  };

  /* --------------------------------------------------------------- embudo */
  chart.funnel = function (container, spec) {
    const first = spec.steps.length ? spec.steps[0].value : 0;
    const max = Math.max.apply(null, spec.steps.map(function (s2) { return s2.value; }).concat([1]));
    container.innerHTML = '<div class="stack" style="gap:9px">' + spec.steps.map(function (st, i) {
      const w = Math.max(2, (st.value / max) * 100);
      const conv = (i === 0 || spec.conversion === false) ? null
        : (spec.steps[i - 1].value ? st.value / spec.steps[i - 1].value : 0);
      return '<div class="stack" style="gap:4px">' +
        '<div class="row" style="gap:8px;justify-content:space-between">' +
        '<span class="t-sm truncate"><i class="legend-swatch" style="display:inline-block;background:' +
        (st.color || SERIES[i % SERIES.length]) + ';margin-right:7px"></i>' + esc(st.label) + '</span>' +
        '<span class="row-gap"><span class="t-sm t-num strong">' + util.num(st.value) + '</span>' +
        (conv == null ? '' : '<span class="t-xs faint t-num">' + util.pct(conv) + '</span>') + '</span>' +
        '</div>' +
        '<div style="height:22px;border-radius:6px;background:var(--surface-3);overflow:hidden">' +
        '<div style="height:100%;width:' + w + '%;border-radius:6px;background:' +
        (st.color || SERIES[i % SERIES.length]) + ';opacity:.85;transition:width .5s var(--e-out)"></div></div>' +
        (st.sub ? '<div class="t-xs faint">' + esc(st.sub) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
    if (first) { /* referencia visual del tope, sin números en cada barra */ }
  };

  /* ------------------------------------------------------- mapa de calor */
  /* Magnitud → un solo tono, claro a oscuro. Nunca arcoíris.              */
  chart.heat = function (container, spec) {
    responsive(container, function (root, W) {
      const rows = spec.rows, cols = spec.cols, vals = spec.values;
      const labelW = 34, gap = 3, padT = 16, cellH = spec.cellHeight || 20;
      const cw = Math.max(6, (W - labelW - gap * (cols.length - 1)) / cols.length);
      const H = padT + rows.length * (cellH + gap);
      let max = 0;
      vals.forEach(function (r) { r.forEach(function (v) { max = Math.max(max, v); }); });
      max = max || 1;

      const svg = s('svg', { class: 'chart-svg', height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
      svg.setAttribute('aria-label', spec.title || 'Mapa de calor');

      cols.forEach(function (c, j) {
        if (j % (spec.everyCol || 3) !== 0) return;
        const t = s('text', { class: 'axis-text', x: labelW + j * (cw + gap) + cw / 2, y: 10, 'text-anchor': 'middle' });
        t.textContent = c;
        svg.appendChild(t);
      });

      rows.forEach(function (r, i) {
        const t = s('text', { class: 'axis-text', x: labelW - 8, y: padT + i * (cellH + gap) + cellH / 2 + 3.5, 'text-anchor': 'end' });
        t.textContent = r;
        svg.appendChild(t);
        cols.forEach(function (c, j) {
          const v = vals[i][j] || 0;
          const k = v / max;
          const cell = s('rect', {
            class: 'heat-cell',
            x: labelW + j * (cw + gap), y: padT + i * (cellH + gap),
            width: cw, height: cellH,
            fill: 'var(--accent)',
            'fill-opacity': (0.06 + k * 0.88).toFixed(3)
          });
          cell.addEventListener('pointerenter', function (e) {
            showTip('<div class="t-xs faint" style="margin-bottom:4px">' + esc(r + ' · ' + c) + '</div>' +
              '<div class="chart-tip-row"><span>' + esc(spec.valueLabel || 'Mensajes') + '</span><b class="t-num">' +
              util.num(v) + '</b></div>', e.clientX, e.clientY);
          });
          cell.addEventListener('pointerleave', hideTip);
          svg.appendChild(cell);
        });
      });

      root.appendChild(svg);
    });
  };

  /* ------------------------------------------------------------- minigráfico */
  chart.spark = function (container, values, color) {
    responsive(container, function (root, W) {
      const H = 30, pad = 2;
      const max = Math.max.apply(null, values.concat([1])), min = Math.min.apply(null, values);
      const range = (max - min) || 1;
      const x = function (i) { return (i / Math.max(1, values.length - 1)) * (W - pad * 2) + pad; };
      const y = function (v) { return H - pad - ((v - min) / range) * (H - pad * 2); };
      const d = values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
      const svg = s('svg', { class: 'chart-svg', height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' });
      svg.appendChild(s('path', { d: d, fill: 'none', stroke: color || 'var(--accent)', 'stroke-width': 1.75, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: .9 }));
      const last = values.length - 1;
      svg.appendChild(s('circle', { cx: x(last), cy: y(values[last]), r: 2.6, fill: color || 'var(--accent)' }));
      root.appendChild(svg);
    });
  };

  /* ---------------------------------------------- vista de datos en tabla */
  /* Toda visualización tiene equivalente tabular: la identidad nunca queda
     sólo en el color.                                                      */
  chart.dataTable = function (headers, rows) {
    return '<div class="table-wrap" style="max-height:300px"><table class="table"><thead><tr>' +
      headers.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div>';
  };

})(window.CRM);
