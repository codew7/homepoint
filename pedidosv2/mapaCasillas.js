// ==========================================
// MAPA DE CASILLAS (pedidosv2)
// ==========================================
// Vista informativa y opcional: dibuja el deposito como una cuadricula de
// casillas (columnas A, B, C... y filas 1, 2, 3...) y muestra en cada una el
// pedido que la ocupa con su avance de armado.
//
// Es SOLO lectura sobre los pedidos: nunca escribe en pedidos/<id>. Lo unico
// que guarda es el tamano de la cuadricula, en casillasMapa (4 valores).
//
// Se carga recien cuando se pide desde el menu de Pedidos pendientes
// (pedidosv2.html, #ppBtnMapaCasillas) y reutiliza las funciones globales de
// la app: db, celdasDe, celdaColNum, celdaColTxt, escapeHtml, controlEstado,
// textoAntiguedad, conTimeout, showToast, cerrarPanelPedidos y cargarPedido.
//
// Datos: escucha pedidos ABIERTO y CERRADO solo mientras el mapa esta a la
// vista. Son las mismas consultas que la lista en vivo, asi que el SDK de
// Firebase las comparte y no se descarga nada de mas.
(function () {
  'use strict';

  const RUTA_CONFIG = 'casillasMapa';
  const LS_CONFIG = 'pv2.casillasMapa';
  const PAUSA_MS = 90;
  const MAX_CASILLAS = 900;
  const DEFECTO = { colDesde: 'A', colHasta: 'D', filaDesde: 1, filaHasta: 6 };

  // ------------------------------------------
  // ESTILOS (se inyectan una sola vez)
  // ------------------------------------------
  const CSS = `
    @property --mc-p { syntax: '<percentage>'; inherits: true; initial-value: 0%; }

    .mc-panel {
      position: fixed; inset: 0; z-index: 210;
      display: none; align-items: center; justify-content: center;
      padding: 20px; background: var(--scrim);
      animation: fadeIn .16s ease both;
    }
    .mc-panel.active { display: flex; }
    .mc-box {
      position: relative; width: 100%; max-width: 1120px; height: min(90vh, 900px);
      display: flex; flex-direction: column; overflow: hidden;
      background: var(--surface); border-radius: var(--r4); box-shadow: var(--sh3);
      animation: sheetIn .26s var(--ease-out) both;
      outline: none;
    }

    /* Cabecera */
    .mc-head { flex: none; display: flex; align-items: center; gap: 12px; padding: 18px 20px 12px; }
    .mc-head-ic {
      flex: none; width: 38px; height: 38px; border-radius: 11px;
      display: flex; align-items: center; justify-content: center;
      background: var(--accent-soft); color: var(--accent);
    }
    .mc-head-ic svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
    .mc-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .mc-title h3 { font-size: 18px; font-weight: 800; letter-spacing: -.4px; color: var(--ink); }
    .mc-resumen { font-size: 12.5px; font-weight: 500; color: var(--ink-3); font-variant-numeric: tabular-nums; }
    .mc-resumen b { color: var(--ink); font-weight: 700; }
    .mc-btn-ic {
      flex: none; width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 11px;
      display: flex; align-items: center; justify-content: center;
      background: var(--surface); color: var(--ink-2); cursor: pointer;
      transition: background .14s, color .14s, transform .12s;
      -webkit-tap-highlight-color: transparent;
    }
    .mc-btn-ic:hover { background: var(--surface-2); color: var(--ink); }
    .mc-btn-ic:active { transform: scale(.94); }
    .mc-btn-ic svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    /* Leyenda */
    .mc-leyenda {
      flex: none; display: flex; flex-wrap: wrap; gap: 6px 14px;
      padding: 0 20px 12px; font-size: 11.5px; font-weight: 600; color: var(--ink-3);
    }
    .mc-leyenda span { display: inline-flex; align-items: center; gap: 6px; }
    .mc-leyenda i { width: 9px; height: 9px; border-radius: 3px; background: var(--mc-tono); }

    /* Aviso de configuracion */
    .mc-aviso {
      flex: none; display: flex; align-items: center; gap: 10px;
      margin: 0 20px 12px; padding: 10px 12px; border-radius: var(--r2);
      background: var(--warn-soft); color: var(--ink-2); font-size: 12.5px; font-weight: 600;
    }
    .mc-aviso[hidden] { display: none; }
    .mc-aviso span { flex: 1; }
    .mc-aviso button {
      flex: none; height: 30px; padding: 0 12px; border: 0; border-radius: 8px;
      background: var(--inverso-bg); color: var(--inverso-fg); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
    }

    /* Cuadricula */
    .mc-scroll {
      flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain;
      border-top: 1px solid var(--line-2); background: var(--surface-2);
    }
    .mc-grid {
      display: grid; gap: 6px; padding: 0 14px 14px 0;
      width: max-content; min-width: 100%;
      grid-template-columns: 38px repeat(var(--mc-cols), minmax(118px, 1fr));
      grid-auto-rows: 96px;
    }
    .mc-grid > .mc-hcol, .mc-grid > .mc-hfila, .mc-grid > .mc-esq {
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-mono); font-size: 12px; font-weight: 800; color: var(--ink-3);
      background: var(--surface-2); position: sticky; z-index: 2;
    }
    .mc-grid > .mc-hcol { top: 0; height: 34px; align-self: start; }
    .mc-grid > .mc-hfila { left: 0; }
    .mc-grid > .mc-esq { top: 0; left: 0; z-index: 3; height: 34px; align-self: start; }
    .mc-grid { --mc-cols: 1; grid-template-rows: 34px; }

    .mc-celda {
      --mc-tono: var(--ink-4);
      --mc-soft: var(--surface-3);
      position: relative; min-width: 0; overflow: hidden;
      display: flex; flex-direction: column; gap: 4px;
      padding: 8px 9px 9px; border-radius: 12px; text-align: left;
      font: inherit; color: var(--ink);
      transition: opacity .2s, transform .16s var(--ease-out), box-shadow .2s, --mc-p .7s var(--ease-out);
    }
    .mc-celda--vacia {
      border: 1px dashed var(--line); background: transparent;
      align-items: center; justify-content: center;
    }
    .mc-celda--vacia .mc-coord { position: static; color: var(--ink-4); opacity: .7; font-size: 12px; }
    .mc-celda--ocupada {
      border: 1px solid var(--line); cursor: pointer;
      background:
        linear-gradient(to top, var(--mc-soft) var(--mc-p), transparent var(--mc-p)),
        var(--surface);
      box-shadow: var(--sh1);
      -webkit-tap-highlight-color: transparent;
    }
    .mc-celda--ocupada:hover { box-shadow: var(--sh2); }
    .mc-celda--ocupada:active { transform: scale(.97); }
    .mc-celda--ocupada::before {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--mc-tono);
    }
    .mc-t-nuevo { --mc-tono: var(--ink-4); --mc-soft: var(--surface-3); }
    .mc-t-armando { --mc-tono: var(--prep); --mc-soft: var(--prep-soft); }
    .mc-t-completo, .mc-t-controlado { --mc-tono: var(--ok); --mc-soft: var(--ok-soft); }

    .mc-coord {
      position: absolute; top: 7px; right: 8px;
      font-family: var(--font-mono); font-size: 10.5px; font-weight: 800; letter-spacing: .2px; color: var(--ink-4);
    }
    .mc-nombre {
      padding-right: 26px; font-size: 13px; font-weight: 700; line-height: 1.25; letter-spacing: -.1px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
    }
    .mc-pie { margin-top: auto; display: flex; align-items: center; gap: 7px; }
    .mc-barra { flex: 1; height: 4px; border-radius: 4px; background: var(--line); overflow: hidden; }
    .mc-barra i {
      display: block; height: 100%; width: var(--mc-p); border-radius: inherit; background: var(--mc-tono);
    }
    .mc-pct {
      flex: none; min-width: 30px; text-align: right;
      font-family: var(--font-mono); font-size: 11.5px; font-weight: 800; color: var(--mc-tono);
      font-variant-numeric: tabular-nums;
    }
    .mc-pct svg { width: 13px; height: 13px; vertical-align: -2px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .mc-multi {
      position: absolute; top: 7px; right: 8px; padding: 1px 5px; border-radius: 5px;
      background: var(--warn-soft); color: var(--warn); font-size: 10px; font-weight: 800;
    }
    .mc-celda--multi .mc-coord { right: 34px; }
    .mc-sub { font-size: 11px; font-weight: 600; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Seleccion: el pedido elegido se resalta en todas sus casillas */
    .mc-grid.has-sel .mc-celda { opacity: .38; }
    .mc-grid.has-sel .mc-celda.is-sel { opacity: 1; box-shadow: 0 0 0 2px var(--mc-tono), var(--sh2); }
    .mc-celda.is-cambio { animation: mcCambio .9s var(--ease-out); }
    @keyframes mcCambio {
      0% { box-shadow: 0 0 0 0 var(--mc-tono), var(--sh1); }
      35% { box-shadow: 0 0 0 3px var(--mc-tono), var(--sh2); }
      100% { box-shadow: var(--sh1); }
    }
    .mc-grid.mc-entra .mc-celda { animation: mcEntra .42s var(--ease-out) both; animation-delay: calc(var(--mc-i, 0) * 14ms); }
    @keyframes mcEntra { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }

    /* Fuera del mapa */
    .mc-fuera {
      flex: none; display: flex; align-items: center; gap: 8px; overflow-x: auto;
      padding: 10px 20px; border-top: 1px solid var(--line-2); background: var(--surface);
      font-size: 12px; font-weight: 700; color: var(--ink-3);
    }
    .mc-fuera[hidden] { display: none; }
    .mc-fuera button {
      flex: none; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 4px;
      border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2);
      font: inherit; font-size: 12px; font-weight: 700; color: var(--ink); cursor: pointer;
    }
    .mc-fuera .celda-chip { height: 22px; min-width: 32px; font-size: 11.5px; }

    .mc-estado {
      grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      padding: 60px 20px; font-size: 13px; font-weight: 600; color: var(--ink-3);
    }

    /* Hojas internas (ficha y tamano) */
    .mc-velo {
      position: absolute; inset: 0; z-index: 5; background: rgba(0, 0, 0, .18);
      opacity: 0; pointer-events: none; transition: opacity .22s;
    }
    .mc-box.con-hoja .mc-velo { opacity: 1; pointer-events: auto; }
    .mc-hoja {
      position: absolute; left: 50%; bottom: 14px; z-index: 6;
      width: min(420px, calc(100% - 28px)); padding: 20px 20px 16px;
      background: var(--surface); border-radius: var(--r3); box-shadow: var(--sh3);
      transform: translate(-50%, calc(100% + 30px)); visibility: hidden;
      transition: transform .34s cubic-bezier(.32, .72, 0, 1), visibility 0s linear .34s;
    }
    .mc-hoja.active { transform: translate(-50%, 0); visibility: visible; transition: transform .34s cubic-bezier(.32, .72, 0, 1), visibility 0s; }
    .mc-hoja h4 { font-size: 17px; font-weight: 800; letter-spacing: -.3px; color: var(--ink); line-height: 1.25; }
    .mc-hoja-sub { margin-top: 4px; font-size: 12.5px; font-weight: 600; color: var(--ink-3); }
    .mc-ficha-celdas { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
    .mc-ficha-av { margin-top: 16px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .mc-ficha-av b { font-family: var(--font-mono); font-size: 26px; font-weight: 800; letter-spacing: -.5px; color: var(--mc-tono); }
    .mc-ficha-av span { font-size: 12.5px; font-weight: 600; color: var(--ink-3); }
    .mc-ficha .mc-barra { height: 6px; margin-top: 8px; }
    .mc-ficha-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .mc-tag {
      display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 7px;
      background: var(--surface-3); color: var(--ink-2); font-size: 11.5px; font-weight: 700;
    }
    .mc-tag svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .mc-tag.ok { background: var(--ok-soft); color: var(--ok); }
    .mc-tag.prep { background: var(--prep-soft); color: var(--prep); }
    .mc-tag.bad { background: var(--bad-soft); color: var(--bad); }
    .mc-hoja .modal-btns { margin-top: 18px; }
    .mc-hoja .celdas-rango { margin-top: 14px; }
    .mc-hoja .celdas-resumen { margin-top: 4px; }

    @media (max-width: 600px) {
      .mc-panel { padding: 0; align-items: stretch; }
      .mc-box { height: 100%; max-width: none; border-radius: 0; }
      .mc-head { padding: 14px 14px 10px; }
      .mc-leyenda { padding: 0 14px 10px; }
      .mc-aviso { margin: 0 14px 10px; }
      .mc-grid { grid-template-columns: 32px repeat(var(--mc-cols), minmax(104px, 1fr)); grid-auto-rows: 88px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .mc-celda, .mc-hoja, .mc-velo { transition: none; }
      .mc-grid.mc-entra .mc-celda, .mc-celda.is-cambio { animation: none; }
    }
  `;

  const IC_GRILLA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"></rect><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"></rect><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"></rect><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"></rect></svg>';
  const IC_AJUSTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="17" x2="20" y2="17"></line><circle cx="9" cy="7" r="2.4" fill="var(--surface)"></circle><circle cx="15" cy="17" r="2.4" fill="var(--surface)"></circle></svg>';
  const IC_CERRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>';
  const IC_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  const HTML = `
    <div class="mc-box" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="mcTitulo">
      <div class="mc-head">
        <span class="mc-head-ic">${IC_GRILLA}</span>
        <div class="mc-title">
          <h3 id="mcTitulo">Mapa de casillas</h3>
          <span class="mc-resumen" id="mcResumen">Cargando...</span>
        </div>
        <button type="button" class="mc-btn-ic" id="mcBtnAjustar" title="Tamaño del depósito" aria-label="Tamaño del depósito">${IC_AJUSTE}</button>
        <button type="button" class="mc-btn-ic" id="mcBtnCerrar" title="Cerrar" aria-label="Cerrar">${IC_CERRAR}</button>
      </div>
      <div class="mc-leyenda" aria-hidden="true">
        <span><i style="background:var(--ink-4)"></i>Sin empezar</span>
        <span><i style="background:var(--prep)"></i>Armando</span>
        <span><i style="background:var(--ok)"></i>Completo</span>
        <span><span class="mc-pct" style="color:var(--ok);min-width:0">${IC_CHECK}</span>Controlado</span>
      </div>
      <div class="mc-aviso" id="mcAviso" hidden>
        <span>Todavía no se configuró el tamaño del depósito: se muestra lo necesario para ver las casillas ocupadas.</span>
        <button type="button" id="mcAvisoAjustar">Ajustar</button>
      </div>
      <div class="mc-scroll" id="mcScroll">
        <div class="mc-grid" id="mcGrid"></div>
      </div>
      <div class="mc-fuera" id="mcFuera" hidden></div>

      <div class="mc-velo" id="mcVelo"></div>

      <div class="mc-hoja mc-ficha" id="mcFicha" role="dialog" aria-labelledby="mcFichaNombre"></div>

      <div class="mc-hoja" id="mcConfig" role="dialog" aria-labelledby="mcConfigTitulo">
        <h4 id="mcConfigTitulo">Tamaño del depósito</h4>
        <div class="mc-hoja-sub">Letras = columnas, números = filas, igual que en las etiquetas de las casillas. Se guarda para todos los equipos.</div>
        <div class="celdas-rango">
          <span></span><label for="mcColDesde">Desde</label><label for="mcColHasta">Hasta</label>
          <label>Columnas</label>
          <input type="text" id="mcColDesde" class="rotulo-qty-input" maxlength="2" autocomplete="off">
          <input type="text" id="mcColHasta" class="rotulo-qty-input" maxlength="2" autocomplete="off">
          <label>Filas</label>
          <input type="number" id="mcFilaDesde" class="rotulo-qty-input" min="1" max="999">
          <input type="number" id="mcFilaHasta" class="rotulo-qty-input" min="1" max="999">
        </div>
        <div class="celdas-resumen" id="mcConfigResumen"></div>
        <div class="modal-btns">
          <button type="button" class="btn-cancel" id="mcConfigCancelar">Cancelar</button>
          <button type="button" class="btn-primary" id="mcConfigGuardar">Guardar</button>
        </div>
      </div>
    </div>`;

  // ------------------------------------------
  // ESTADO
  // ------------------------------------------
  let panel = null;
  let grid = null;
  let config = null;          // { colDesde, colHasta, filaDesde, filaHasta } normalizado
  let configGuardada = false; // false: se dedujo de las casillas ocupadas
  let vivo = null;            // { snaps, subs }
  let pintarTimer = null;
  let pedidos = [];           // pedidos con casillas, ya resumidos
  let porCelda = new Map();   // 'C4' -> [pedido...]
  let firmas = new Map();     // 'C4' -> firma pintada
  let gridClave = '';         // rango de la cuadricula armada
  let seleccion = null;       // id del pedido elegido

  // ------------------------------------------
  // CONFIGURACION
  // ------------------------------------------
  function normalizar(c) {
    if (!c || typeof c !== 'object') return null;
    const c1 = celdaColNum(c.colDesde), c2 = celdaColNum(c.colHasta);
    const f1 = parseInt(c.filaDesde, 10), f2 = parseInt(c.filaHasta, 10);
    if (!c1 || !c2 || !(f1 >= 1 && f1 <= 999) || !(f2 >= 1 && f2 <= 999)) return null;
    return {
      c1: Math.min(c1, c2), c2: Math.max(c1, c2),
      f1: Math.min(f1, f2), f2: Math.max(f1, f2)
    };
  }

  function aGuardar(n) {
    return { colDesde: celdaColTxt(n.c1), colHasta: celdaColTxt(n.c2), filaDesde: n.f1, filaHasta: n.f2 };
  }

  function leerLocal() {
    try { return normalizar(JSON.parse(localStorage.getItem(LS_CONFIG) || 'null')); } catch (e) { return null; }
  }
  function escribirLocal(n) {
    try { localStorage.setItem(LS_CONFIG, JSON.stringify(aGuardar(n))); } catch (e) { /* sin almacenamiento */ }
  }

  async function cargarConfig() {
    const local = leerLocal();
    if (local) { config = local; configGuardada = true; }
    try {
      const snap = await conTimeout(() => db.ref(RUTA_CONFIG).once('value'));
      const remota = normalizar(snap.val());
      if (remota) { config = remota; configGuardada = true; escribirLocal(remota); }
    } catch (e) {
      console.warn('Mapa de casillas: no se pudo leer el tamaño guardado', e);
    }
  }

  // Sin tamano guardado: desde A1 hasta la casilla ocupada mas lejana.
  function configEfectiva() {
    if (config) return config;
    let c2 = celdaColNum(DEFECTO.colHasta), f2 = DEFECTO.filaHasta;
    porCelda.forEach((_, celda) => {
      const m = /^([A-Z]+)(\d+)$/.exec(celda);
      if (!m) return;
      c2 = Math.max(c2, celdaColNum(m[1]));
      f2 = Math.max(f2, parseInt(m[2], 10));
    });
    return { c1: 1, c2: c2, f1: 1, f2: f2 };
  }

  // ------------------------------------------
  // DATOS
  // ------------------------------------------
  function resumirPedido(id, p) {
    const celdas = celdasDe(p);
    if (!celdas.length) return null;
    const items = p.items ? (Array.isArray(p.items) ? p.items : Object.values(p.items)) : [];
    const validos = items.filter(Boolean);
    const listos = validos.filter(it => it.listo === 'y').length;
    const total = validos.length;
    const pct = total ? Math.round(listos / total * 100) : 0;
    let controlado = false;
    try { controlado = !!controlEstado(p).finalValido; } catch (e) { /* sin datos de control */ }
    const estado = controlado ? 'controlado' : (total && listos === total) ? 'completo' : listos > 0 ? 'armando' : 'nuevo';
    return {
      id: id,
      nombre: (p.cliente && p.cliente.nombre) || 'Sin nombre',
      celdas: celdas,
      listos: listos,
      total: total,
      pct: pct,
      estado: estado,
      controlado: controlado,
      embalado: p.embalado === true,
      status: p.status,
      timestamp: p.timestamp || 0
    };
  }

  function reconstruir() {
    const lista = [];
    ['ABIERTO', 'CERRADO'].forEach(st => {
      vivo.snaps[st].forEach(ch => {
        const p = ch.val();
        const r = p && resumirPedido(ch.key, p);
        if (r) lista.push(r);
      });
    });
    lista.sort((a, b) => a.timestamp - b.timestamp);
    pedidos = lista;
    porCelda = new Map();
    lista.forEach(p => p.celdas.forEach(c => {
      if (!porCelda.has(c)) porCelda.set(c, []);
      porCelda.get(c).push(p);
    }));
    if (seleccion && !lista.some(p => p.id === seleccion)) cerrarFicha();
  }

  function suscribir() {
    if (vivo) return;
    const v = { snaps: {}, subs: [] };
    vivo = v;
    ['ABIERTO', 'CERRADO'].forEach(st => {
      const q = db.ref('pedidos').orderByChild('status').equalTo(st);
      const cb = q.on('value', snap => {
        if (vivo !== v) return;
        v.snaps[st] = snap;
        if (!v.snaps.ABIERTO || !v.snaps.CERRADO) return;
        clearTimeout(pintarTimer);
        pintarTimer = setTimeout(() => { reconstruir(); pintar(); }, PAUSA_MS);
      }, err => {
        if (vivo !== v) return;
        console.error('Mapa de casillas: error escuchando pedidos', err);
        document.getElementById('mcResumen').textContent = 'Sin conexión: no se pudo cargar el mapa';
      });
      v.subs.push([q, cb]);
    });
  }

  function desuscribir() {
    clearTimeout(pintarTimer);
    pintarTimer = null;
    if (!vivo) return;
    vivo.subs.forEach(([q, cb]) => q.off('value', cb));
    vivo = null;
  }

  // ------------------------------------------
  // PINTADO
  // ------------------------------------------
  function htmlPct(p) {
    return p.estado === 'controlado' || p.estado === 'completo'
      ? (p.estado === 'controlado' ? IC_CHECK : '100%')
      : p.pct + '%';
  }

  function contenidoCelda(celda, lista) {
    if (!lista || !lista.length) {
      return { clase: 'mc-celda mc-celda--vacia', p: 0, html: '<span class="mc-coord">' + celda + '</span>', firma: '' };
    }
    const p = lista[0];
    const multi = lista.length > 1;
    let html = '<span class="mc-coord">' + celda + '</span>';
    if (multi) html += '<span class="mc-multi" title="Hay ' + lista.length + ' pedidos en esta casilla">×' + lista.length + '</span>';
    html += '<span class="mc-nombre">' + escapeHtml(p.nombre) + '</span>';
    if (multi) html += '<span class="mc-sub">+ ' + lista.slice(1).map(x => escapeHtml(x.nombre)).join(', ') + '</span>';
    else if (p.celdas.length > 1) html += '<span class="mc-sub">' + p.celdas.length + ' casillas</span>';
    html += '<span class="mc-pie"><span class="mc-barra"><i></i></span><span class="mc-pct">' + htmlPct(p) + '</span></span>';
    return {
      clase: 'mc-celda mc-celda--ocupada mc-t-' + p.estado + (multi ? ' mc-celda--multi' : ''),
      p: p.estado === 'controlado' ? 100 : p.pct,
      html: html,
      firma: lista.map(x => x.id + ':' + x.nombre + ':' + x.pct + ':' + x.estado + ':' + x.celdas.length).join('|'),
      ids: lista.map(x => x.id)
    };
  }

  function armarGrilla(cfg) {
    const cols = cfg.c2 - cfg.c1 + 1;
    grid.style.setProperty('--mc-cols', cols);
    let h = '<div class="mc-esq"></div>';
    for (let c = cfg.c1; c <= cfg.c2; c++) h += '<div class="mc-hcol">' + celdaColTxt(c) + '</div>';
    let i = 0;
    for (let f = cfg.f1; f <= cfg.f2; f++) {
      h += '<div class="mc-hfila">' + f + '</div>';
      for (let c = cfg.c1; c <= cfg.c2; c++) {
        const celda = celdaColTxt(c) + f;
        h += '<div class="mc-celda mc-celda--vacia" data-celda="' + celda + '" style="--mc-i:' + Math.min(i++, 40) + '"></div>';
      }
    }
    grid.innerHTML = h;
    firmas = new Map();
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducir) {
      grid.classList.remove('mc-entra');
      void grid.offsetWidth;
      grid.classList.add('mc-entra');
      setTimeout(() => grid && grid.classList.remove('mc-entra'), 1200);
    }
  }

  function pintar() {
    if (!panel || !panel.classList.contains('active')) return;
    const cfg = configEfectiva();
    const clave = [cfg.c1, cfg.c2, cfg.f1, cfg.f2].join(',');
    const primera = clave !== gridClave;
    if (primera) { armarGrilla(cfg); gridClave = clave; }

    grid.querySelectorAll('.mc-celda[data-celda]').forEach(el => {
      const celda = el.dataset.celda;
      const d = contenidoCelda(celda, porCelda.get(celda));
      const firmaVieja = firmas.get(celda);
      if (firmaVieja === d.firma && !primera) return;
      const ocupada = !!d.firma;
      // La casilla vacia es un div; la ocupada, un boton accesible.
      let nodo = el;
      if ((el.tagName === 'BUTTON') !== ocupada) {
        nodo = document.createElement(ocupada ? 'button' : 'div');
        if (ocupada) nodo.type = 'button';
        nodo.dataset.celda = celda;
        nodo.style.cssText = el.style.cssText;
        el.replaceWith(nodo);
      }
      nodo.className = d.clase;
      nodo.innerHTML = d.html;
      if (ocupada) {
        nodo.dataset.ids = d.ids.join(',');
        const p = porCelda.get(celda)[0];
        nodo.setAttribute('aria-label', 'Casilla ' + celda + ': ' + p.nombre + ', ' +
          (p.controlado ? 'controlado' : p.pct + '% armado'));
        // Primero sin avance y en el cuadro siguiente el valor real: asi el
        // relleno sube con la transicion en lugar de aparecer de golpe.
        if (firmaVieja === undefined || firmaVieja === '') {
          nodo.style.setProperty('--mc-p', '0%');
          requestAnimationFrame(() => requestAnimationFrame(() => nodo.style.setProperty('--mc-p', d.p + '%')));
        } else {
          nodo.style.setProperty('--mc-p', d.p + '%');
        }
        if (!primera && firmaVieja !== undefined) {
          nodo.classList.add('is-cambio');
          setTimeout(() => nodo.classList.remove('is-cambio'), 950);
        }
      } else {
        delete nodo.dataset.ids;
        nodo.removeAttribute('aria-label');
        nodo.style.removeProperty('--mc-p');
      }
      firmas.set(celda, d.firma);
    });

    aplicarSeleccion();
    pintarResumen(cfg);
    pintarFuera(cfg);
    document.getElementById('mcAviso').hidden = configGuardada;
    if (seleccion) pintarFicha(seleccion);
  }

  function pintarResumen(cfg) {
    const totalCasillas = (cfg.c2 - cfg.c1 + 1) * (cfg.f2 - cfg.f1 + 1);
    let ocupadas = 0;
    porCelda.forEach((_, c) => { if (dentro(c, cfg)) ocupadas++; });
    const n = pedidos.length;
    const completos = pedidos.filter(p => p.estado === 'completo' || p.estado === 'controlado').length;
    document.getElementById('mcResumen').innerHTML =
      '<b>' + ocupadas + '</b> de ' + totalCasillas + ' casillas ocupadas · ' +
      '<b>' + n + '</b> ' + (n === 1 ? 'pedido' : 'pedidos') +
      (n ? ' · ' + completos + (completos === 1 ? ' completo' : ' completos') : '');
  }

  function dentro(celda, cfg) {
    const m = /^([A-Z]+)(\d+)$/.exec(celda);
    if (!m) return false;
    const c = celdaColNum(m[1]), f = parseInt(m[2], 10);
    return c >= cfg.c1 && c <= cfg.c2 && f >= cfg.f1 && f <= cfg.f2;
  }

  function pintarFuera(cfg) {
    const el = document.getElementById('mcFuera');
    const fuera = [];
    porCelda.forEach((lista, c) => { if (!dentro(c, cfg)) lista.forEach(p => fuera.push({ c, p })); });
    el.hidden = fuera.length === 0;
    if (!fuera.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<span>Fuera del mapa</span>' + fuera.map(x =>
      '<button type="button" data-id="' + escapeHtml(x.p.id) + '"><span class="celda-chip">' + x.c + '</span>' +
      escapeHtml(x.p.nombre) + '</button>').join('');
  }

  function aplicarSeleccion() {
    grid.classList.toggle('has-sel', !!seleccion);
    grid.querySelectorAll('.mc-celda--ocupada').forEach(el => {
      el.classList.toggle('is-sel', !!seleccion && (el.dataset.ids || '').split(',').includes(seleccion));
    });
  }

  // ------------------------------------------
  // FICHA DEL PEDIDO
  // ------------------------------------------
  function pintarFicha(id) {
    const p = pedidos.find(x => x.id === id);
    const el = document.getElementById('mcFicha');
    if (!p) return;
    const ant = textoAntiguedad(p.timestamp);
    const tags = [];
    if (p.controlado) tags.push('<span class="mc-tag ok">' + IC_CHECK + 'Controlado</span>');
    else if (p.estado === 'completo') tags.push('<span class="mc-tag ok">Armado completo</span>');
    else if (p.estado === 'armando') tags.push('<span class="mc-tag prep">Armando</span>');
    else tags.push('<span class="mc-tag">Sin empezar</span>');
    if (p.embalado) tags.push('<span class="mc-tag ok">Embalado</span>');
    if (ant.texto) {
      const dias = parseInt(ant.texto, 10);
      const txt = ant.texto === 'hoy' ? 'Entró hoy' : 'Hace ' + dias + (dias === 1 ? ' día' : ' días');
      tags.push('<span class="mc-tag' + (ant.viejo ? ' bad' : '') + '">' + txt + '</span>');
    }
    el.className = 'mc-hoja mc-ficha active mc-t-' + p.estado;
    el.style.cssText = '--mc-p:' + (p.controlado ? 100 : p.pct) + '%';
    el.innerHTML =
      '<h4 id="mcFichaNombre">' + escapeHtml(p.nombre) + '</h4>' +
      '<div class="mc-hoja-sub">Pedido ' + escapeHtml(p.id) + ' · ' + String(p.status || '').toLowerCase() + '</div>' +
      '<div class="mc-ficha-celdas">' + p.celdas.map(c => '<span class="celda-chip">' + c + '</span>').join('') + '</div>' +
      '<div class="mc-ficha-av"><b>' + p.pct + '%</b><span>' + p.listos + ' de ' + p.total + ' empacados</span></div>' +
      '<div class="mc-barra"><i></i></div>' +
      '<div class="mc-ficha-tags">' + tags.join('') + '</div>' +
      '<div class="modal-btns">' +
        '<button type="button" class="btn-cancel" data-accion="cerrar">Cerrar</button>' +
        '<button type="button" class="btn-primary" data-accion="abrir">Abrir pedido</button>' +
      '</div>';
  }

  function abrirFicha(id) {
    cerrarConfig(true);
    seleccion = id;
    pintarFicha(id);
    panel.querySelector('.mc-box').classList.add('con-hoja');
    aplicarSeleccion();
    const btn = document.querySelector('#mcFicha [data-accion="abrir"]');
    if (btn) btn.focus({ preventScroll: true });
  }

  function cerrarFicha() {
    seleccion = null;
    const el = document.getElementById('mcFicha');
    if (el) el.classList.remove('active');
    if (panel && !document.getElementById('mcConfig').classList.contains('active')) {
      panel.querySelector('.mc-box').classList.remove('con-hoja');
    }
    if (grid) aplicarSeleccion();
  }

  // ------------------------------------------
  // HOJA DE TAMANO
  // ------------------------------------------
  function leerFormulario() {
    return normalizar({
      colDesde: document.getElementById('mcColDesde').value,
      colHasta: document.getElementById('mcColHasta').value,
      filaDesde: document.getElementById('mcFilaDesde').value,
      filaHasta: document.getElementById('mcFilaHasta').value
    });
  }

  function resumenFormulario() {
    const n = leerFormulario();
    const el = document.getElementById('mcConfigResumen');
    const btn = document.getElementById('mcConfigGuardar');
    let error = '';
    if (!n) error = 'Columnas con letras (A a ZZ) y filas del 1 al 999';
    else if ((n.c2 - n.c1 + 1) * (n.f2 - n.f1 + 1) > MAX_CASILLAS) error = 'Es demasiado grande: el máximo es ' + MAX_CASILLAS + ' casillas';
    el.classList.toggle('error', !!error);
    btn.disabled = !!error;
    if (error) { el.textContent = error; return; }
    const cols = n.c2 - n.c1 + 1, filas = n.f2 - n.f1 + 1;
    el.textContent = cols + (cols === 1 ? ' columna' : ' columnas') + ' × ' + filas + (filas === 1 ? ' fila' : ' filas') +
      ' = ' + cols * filas + ' casillas (' + celdaColTxt(n.c1) + n.f1 + ' a ' + celdaColTxt(n.c2) + n.f2 + ')';
  }

  function abrirConfig() {
    cerrarFicha();
    const g = aGuardar(configEfectiva());
    document.getElementById('mcColDesde').value = g.colDesde;
    document.getElementById('mcColHasta').value = g.colHasta;
    document.getElementById('mcFilaDesde').value = g.filaDesde;
    document.getElementById('mcFilaHasta').value = g.filaHasta;
    resumenFormulario();
    document.getElementById('mcConfig').classList.add('active');
    panel.querySelector('.mc-box').classList.add('con-hoja');
  }

  function cerrarConfig(sinVelo) {
    const el = document.getElementById('mcConfig');
    if (!el) return;
    el.classList.remove('active');
    if (!sinVelo && !seleccion) panel.querySelector('.mc-box').classList.remove('con-hoja');
  }

  async function guardarConfig() {
    const n = leerFormulario();
    if (!n) return;
    const btn = document.getElementById('mcConfigGuardar');
    btn.disabled = true;
    config = n;
    configGuardada = true;
    escribirLocal(n);
    cerrarConfig();
    pintar();
    try {
      await conTimeout(() => db.ref(RUTA_CONFIG).set(aGuardar(n)));
      showToast('Tamaño del depósito guardado');
    } catch (e) {
      console.warn('Mapa de casillas: no se pudo guardar en Firebase', e);
      showToast(e && e.esTimeout ? 'Sin conexión: el tamaño quedó guardado solo en este equipo' : 'El tamaño quedó guardado solo en este equipo');
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------
  // MONTAJE Y EVENTOS
  // ------------------------------------------
  function montar() {
    if (panel) return;
    const st = document.createElement('style');
    st.id = 'mapaCasillasCss';
    st.textContent = CSS;
    document.head.appendChild(st);

    panel = document.createElement('div');
    panel.className = 'mc-panel';
    panel.id = 'mapaCasillas';
    panel.innerHTML = HTML;
    document.body.appendChild(panel);
    grid = document.getElementById('mcGrid');

    panel.addEventListener('click', e => { if (e.target === panel) cerrar(); });
    document.getElementById('mcBtnCerrar').addEventListener('click', cerrar);
    document.getElementById('mcBtnAjustar').addEventListener('click', abrirConfig);
    document.getElementById('mcAvisoAjustar').addEventListener('click', abrirConfig);
    document.getElementById('mcVelo').addEventListener('click', () => { cerrarFicha(); cerrarConfig(); });
    document.getElementById('mcConfigCancelar').addEventListener('click', () => cerrarConfig());
    document.getElementById('mcConfigGuardar').addEventListener('click', guardarConfig);
    ['mcColDesde', 'mcColHasta', 'mcFilaDesde', 'mcFilaHasta'].forEach(id =>
      document.getElementById(id).addEventListener('input', resumenFormulario));

    grid.addEventListener('click', e => {
      const el = e.target.closest('.mc-celda--ocupada');
      if (!el) { if (seleccion) cerrarFicha(); return; }
      const ids = (el.dataset.ids || '').split(',').filter(Boolean);
      if (!ids.length) return;
      // En una casilla con varios pedidos, cada toque pasa al siguiente.
      const i = ids.indexOf(seleccion);
      const id = ids[(i + 1) % ids.length];
      if (id === seleccion && ids.length === 1) { cerrarFicha(); return; }
      abrirFicha(id);
    });

    document.getElementById('mcFuera').addEventListener('click', e => {
      const b = e.target.closest('button[data-id]');
      if (b) abrirFicha(b.dataset.id);
    });

    document.getElementById('mcFicha').addEventListener('click', e => {
      const b = e.target.closest('[data-accion]');
      if (!b) return;
      if (b.dataset.accion === 'cerrar') { cerrarFicha(); return; }
      const id = seleccion;
      if (!id) return;
      cerrar();
      if (typeof cerrarPanelPedidos === 'function') cerrarPanelPedidos();
      cargarPedido(id);
    });

    // Escape cierra de adentro hacia afuera y no llega a la lista de atras.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !panel.classList.contains('active')) return;
      if (document.querySelector('.modal-backdrop.active')) return;
      e.stopPropagation();
      e.preventDefault();
      if (document.getElementById('mcConfig').classList.contains('active')) cerrarConfig();
      else if (seleccion) cerrarFicha();
      else cerrar();
    }, true);
  }

  async function abrir() {
    montar();
    seleccion = null;
    gridClave = '';
    firmas = new Map();
    cerrarFicha();
    cerrarConfig();
    grid.innerHTML = '<div class="mc-estado"><div class="spinner"></div>Cargando el mapa...</div>';
    document.getElementById('mcResumen').textContent = 'Cargando...';
    document.getElementById('mcFuera').hidden = true;
    document.getElementById('mcAviso').hidden = true;
    panel.classList.add('active');
    panel.querySelector('.mc-box').focus({ preventScroll: true });
    await cargarConfig();
    if (!panel.classList.contains('active')) return;
    suscribir();
  }

  function cerrar() {
    if (!panel) return;
    desuscribir();
    cerrarFicha();
    cerrarConfig();
    panel.classList.remove('active');
  }

  window.MapaCasillas = { abrir, cerrar };
})();
