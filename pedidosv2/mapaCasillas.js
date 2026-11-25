// ==========================================
// MAPA DE CASILLAS (pedidosv2)
// ==========================================
// Vista informativa y opcional: dibuja el deposito como una cuadricula de
// casillas (columnas A, B, C... y filas 1, 2, 3...) y muestra en cada una el
// pedido que la ocupa con su avance de armado.
//
// Tambien cruza los traspasos a Caseros creados desde Articulos necesarios
// (traspasos/<id>/cubre) para mostrar que mercaderia espera cada pedido.
//
// Es SOLO lectura sobre los pedidos y traspasos: nunca escribe en ellos. Lo unico
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
  const DEFECTO = { colDesde: 'A', colHasta: 'D', filaDesde: 1, filaHasta: 4 };

  // ------------------------------------------
  // ESTILOS (se inyectan una sola vez)
  // ------------------------------------------
  const CSS = `
    @property --mc-p { syntax: '<percentage>'; inherits: true; initial-value: 0%; }
    /* --mc-q: armado + lo pedido a Caseros (tope de la franja celeste) */
    @property --mc-q { syntax: '<percentage>'; inherits: true; initial-value: 0%; }

    .mc-panel {
      position: fixed; inset: 0; z-index: 210;
      display: none; align-items: center; justify-content: center;
      padding: 20px; background: var(--scrim);
      -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      animation: fadeIn .16s ease both;
    }
    .mc-panel.active { display: flex; }
    .mc-box {
      position: relative; width: 100%; max-width: 1180px; height: min(90vh, 920px);
      display: flex; flex-direction: column; overflow: hidden;
      background: var(--surface); border-radius: var(--r4); box-shadow: var(--sh3);
      animation: sheetIn .26s var(--ease-out) both;
      outline: none;
    }

    /* Cabecera: banda grafito con el resumen y la tira de ocupacion */
    .mc-head {
      flex: none; position: relative; padding: 18px 20px 16px;
      background: var(--graphite); color: var(--on-g);
    }
    .mc-head-fila { display: flex; align-items: center; gap: 12px; }
    .mc-head-ic {
      flex: none; width: 40px; height: 40px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      background: var(--accent); color: #fff;
      box-shadow: 0 6px 18px -6px var(--accent), inset 0 1px 0 rgba(255,255,255,.22);
    }
    .mc-head-ic svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
    .mc-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .mc-title h3 { font-size: 19px; font-weight: 800; letter-spacing: -.5px; color: var(--on-g); line-height: 1.1; }
    .mc-vivo {
      display: inline-flex; align-items: center; gap: 7px;
      font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: .9px; text-transform: uppercase; color: var(--on-g-2);
    }
    .mc-vivo i { position: relative; width: 7px; height: 7px; border-radius: 50%; background: #4fc08d; }
    .mc-vivo i::after {
      content: ''; position: absolute; inset: 0; border-radius: inherit; background: inherit;
      animation: mcLatido 2s ease-out infinite;
    }
    .mc-vivo.is-off i { background: var(--bad); }
    .mc-vivo.is-off i::after { animation: none; }
    @keyframes mcLatido { from { transform: scale(1); opacity: .7; } to { transform: scale(3); opacity: 0; } }
    .mc-btn-ic {
      flex: none; width: 38px; height: 38px; border: 1px solid var(--graphite-line); border-radius: 11px;
      display: flex; align-items: center; justify-content: center;
      background: var(--graphite-2); color: var(--on-g-2); cursor: pointer;
      transition: background .14s, color .14s, transform .12s, border-color .14s;
      -webkit-tap-highlight-color: transparent;
    }
    .mc-btn-ic:hover { color: var(--on-g); border-color: var(--on-g-3); }
    .mc-btn-ic:active { transform: scale(.94); }
    .mc-btn-ic:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .mc-btn-ic svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .mc-btn-ic svg circle { fill: var(--graphite-2); }

    .mc-resumen {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 22px; margin-top: 16px;
      font-size: 12px; font-weight: 600; color: var(--on-g-2);
    }
    .mc-stat { display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
    .mc-stat b {
      font-family: var(--font-mono); font-size: 22px; font-weight: 700; letter-spacing: -.8px; color: var(--on-g);
      font-variant-numeric: tabular-nums; line-height: 1;
    }
    .mc-stat b small { font-size: 13px; font-weight: 600; color: var(--on-g-3); letter-spacing: 0; }
    .mc-stat--pct b { color: #f0a868; }

    /* Tira: una marca por casilla, en el mismo orden que el mapa */
    .mc-tira {
      display: flex; gap: 2px; height: 8px; margin-top: 12px;
    }
    .mc-tira.is-densa { gap: 1px; }
    .mc-tira i {
      flex: 1 1 0; min-width: 0; border-radius: 2px; background: var(--mc-tono, var(--graphite-line));
      transform-origin: bottom; animation: mcTira .5s var(--ease-out) both; animation-delay: calc(var(--mc-i, 0) * 6ms);
    }
    .mc-tira i.mc-libre { --mc-tono: var(--graphite-line); }
    @keyframes mcTira { from { transform: scaleY(.2); opacity: 0; } to { transform: none; opacity: 1; } }

    /* Filtros por estado (con cantidades) */
    .mc-leyenda {
      flex: none; display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none;
      padding: 12px 20px; border-bottom: 1px solid var(--line-2); background: var(--surface);
    }
    .mc-leyenda::-webkit-scrollbar { display: none; }
    .mc-filtro {
      flex: none; display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 11px 0 10px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
      font: inherit; font-size: 12px; font-weight: 700; color: var(--ink-2); cursor: pointer;
      transition: background .15s, border-color .15s, color .15s, box-shadow .15s;
      -webkit-tap-highlight-color: transparent;
    }
    .mc-filtro:hover { border-color: var(--ink-4); color: var(--ink); }
    .mc-filtro:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .mc-filtro i { width: 8px; height: 8px; border-radius: 50%; background: var(--mc-tono); box-shadow: 0 0 0 3px var(--mc-soft); }
    .mc-filtro svg { width: 12px; height: 12px; fill: none; stroke: var(--mc-tono); stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
    .mc-filtro span {
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 6px; margin-left: 1px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--surface-3); font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--ink-3);
      font-variant-numeric: tabular-nums;
    }
    .mc-filtro[aria-pressed="true"] {
      border-color: var(--mc-tono); background: var(--mc-soft); color: var(--ink);
      box-shadow: 0 0 0 1px var(--mc-tono);
    }
    .mc-filtro[aria-pressed="true"] span { background: var(--mc-tono); color: var(--surface); }
    .mc-leyenda-ayuda { flex: none; margin-left: auto; padding-left: 8px; font-size: 11.5px; font-weight: 600; color: var(--ink-4); white-space: nowrap; }


    /* Cuadricula: el area visible siempre muestra 4 filas */
    .mc-scroll {
      flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain;
      container-type: size;
      background-color: var(--surface-2);
      background-image: radial-gradient(var(--line) 1px, transparent 1.3px);
      background-size: 18px 18px; background-attachment: local;
    }
    .mc-grid {
      --mc-gap: 8px;
      display: grid; gap: var(--mc-gap); padding: 0 16px 16px 0;
      width: max-content; min-width: 100%;
      grid-template-columns: 40px repeat(var(--mc-cols), minmax(132px, 1fr));
      grid-template-rows: 36px;
      grid-auto-rows: 104px;
      grid-auto-rows: max(84px, calc((100cqh - 36px - 4 * var(--mc-gap) - 16px) / 4));
    }
    .mc-grid { --mc-cols: 1; }
    .mc-grid > .mc-hcol, .mc-grid > .mc-hfila, .mc-grid > .mc-esq {
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-mono); font-size: 12px; font-weight: 700; letter-spacing: .6px; color: var(--ink-3);
      position: sticky; z-index: 2;
    }
    .mc-grid > .mc-hcol {
      top: 0; height: 36px; align-self: start;
      background: linear-gradient(var(--surface-2) 78%, transparent);
    }
    .mc-grid > .mc-hfila { left: 0; background: linear-gradient(90deg, var(--surface-2) 78%, transparent); }
    .mc-grid > .mc-esq { top: 0; left: 0; z-index: 3; height: 36px; align-self: start; background: var(--surface-2); }
    .mc-hcol b, .mc-hfila b {
      min-width: 26px; height: 22px; padding: 0 6px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--surface); box-shadow: var(--sh1); color: var(--ink-2); font-weight: 700;
    }

    .mc-celda {
      --mc-tono: var(--ink-4);
      --mc-soft: var(--surface-3);
      position: relative; min-width: 0; overflow: hidden;
      display: flex; flex-direction: column; gap: 3px;
      padding: 10px 11px 10px; border-radius: 14px; text-align: left;
      font: inherit; color: var(--ink);
      transition: opacity .25s, transform .2s var(--ease-out), box-shadow .2s, border-color .2s, --mc-p .9s var(--ease-out), --mc-q .9s var(--ease-out);
    }
    .mc-celda--vacia {
      border: 1.5px dashed var(--line); background: color-mix(in srgb, var(--surface-2) 55%, transparent);
      align-items: center; justify-content: center;
    }
    .mc-celda--vacia .mc-coord { color: var(--ink-4); font-size: 12px; opacity: .8; background: none; padding: 0; }
    .mc-celda--vacia .mc-coord::before { display: none; }
    .mc-celda--ocupada {
      border: 1px solid color-mix(in srgb, var(--mc-tono) 22%, var(--line));
      cursor: pointer;
      background:
        linear-gradient(to top,
          var(--mc-soft) var(--mc-p),
          var(--mc-trband) var(--mc-p) var(--mc-q),
          var(--mc-linea) var(--mc-q),
          var(--mc-linea) calc(var(--mc-q) + 1.5px),
          transparent calc(var(--mc-q) + 1.5px)),
        var(--surface);
      box-shadow: var(--sh1);
      -webkit-tap-highlight-color: transparent;
      --mc-trband: color-mix(in srgb, var(--int) 24%, var(--surface));
      --mc-linea: color-mix(in srgb, var(--mc-tono) 55%, transparent);
    }
    .mc-celda--ocupada.mc-con-tr { --mc-linea: color-mix(in srgb, var(--int) 70%, transparent); }
    .mc-celda--ocupada:hover { transform: translateY(-2px); box-shadow: var(--sh2); border-color: color-mix(in srgb, var(--mc-tono) 45%, var(--line)); }
    .mc-celda--ocupada:active { transform: scale(.97); }
    .mc-celda--ocupada:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .mc-t-nuevo { --mc-tono: var(--ink-4); --mc-soft: var(--surface-3); }
    .mc-t-armando { --mc-tono: var(--prep); --mc-soft: var(--prep-soft); }
    .mc-t-completo { --mc-tono: var(--ok); --mc-soft: var(--ok-soft); }
    .mc-t-controlado { --mc-tono: var(--ok); --mc-soft: color-mix(in srgb, var(--ok) 20%, var(--surface)); }

    .mc-cab { display: flex; align-items: center; gap: 6px; min-height: 20px; }
    .mc-coord {
      display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 7px 0 6px; border-radius: 6px;
      background: color-mix(in srgb, var(--surface) 80%, transparent);
      font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: .4px; color: var(--ink-2);
    }
    .mc-coord::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--mc-tono); }
    .mc-multi {
      margin-left: auto; height: 20px; padding: 0 6px; border-radius: 6px;
      display: inline-flex; align-items: center;
      background: var(--warn-soft); color: var(--warn); font-family: var(--font-mono); font-size: 10.5px; font-weight: 700;
    }
    .mc-nombre {
      margin-top: 4px; font-size: 13.5px; font-weight: 700; line-height: 1.22; letter-spacing: -.2px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
    }
    .mc-sub { font-size: 11px; font-weight: 600; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mc-pie { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
    .mc-pct {
      font-family: var(--font-mono); font-size: 21px; font-weight: 700; letter-spacing: -1px; line-height: 1;
      color: color-mix(in srgb, var(--mc-tono) 85%, var(--ink));
      font-variant-numeric: tabular-nums;
    }
    .mc-pct small { font-size: 11px; font-weight: 600; letter-spacing: 0; margin-left: 1px; opacity: .7; }
    .mc-pct--ok {
      width: 24px; height: 24px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--ok); color: #fff; box-shadow: 0 4px 12px -4px var(--ok);
    }
    .mc-pct svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
    .mc-pct-tr {
      font-family: var(--font-mono); font-size: 12px; font-weight: 700; letter-spacing: -.3px; color: var(--int);
      margin-left: 3px; font-variant-numeric: tabular-nums;
    }
    .mc-items { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--ink-3); font-variant-numeric: tabular-nums; }

    /* Traspasos: marca en la casilla */
    .mc-tr {
      margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: 6px;
      background: var(--int-soft); color: var(--int);
      font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .2px; white-space: nowrap;
    }
    .mc-tr svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
    .mc-tr--falta { background: var(--bad-soft); color: var(--bad); }
    .mc-tr--llego { background: var(--ok-soft); color: var(--ok); }
    .mc-tr + .mc-multi { margin-left: 0; }
    .mc-tr--espera svg { animation: mcRuta 1.6s ease-in-out infinite; }
    @keyframes mcRuta { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(1.5px); } }

    .mc-leyenda-sep { flex: none; width: 1px; height: 20px; margin: 0 4px; background: var(--line); }
    .mc-f-tr { --mc-tono: var(--int); --mc-soft: var(--int-soft); }
    .mc-filtro.mc-f-tr svg { width: 15px; height: 15px; stroke-width: 2; stroke-linejoin: round; }

    /* Traspasos: detalle en la ficha */
    .mc-trs { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
    .mc-trs-tit {
      display: flex; align-items: center; gap: 6px;
      font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: var(--ink-3);
    }
    .mc-trs-tit svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
    .mc-trs-aviso { padding: 10px 12px; border-radius: var(--r2); background: var(--warn-soft); color: var(--ink-2); font-size: 12px; font-weight: 600; }
    .mc-tr-grupo { border: 1px solid var(--line); border-radius: var(--r2); overflow: hidden; }
    .mc-tr-cab {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; background: var(--surface-2);
      font-size: 12px; font-weight: 600; color: var(--ink-3);
    }
    .mc-tr-cab b { font-family: var(--font-mono); font-size: 12.5px; font-weight: 700; color: var(--ink); }
    .mc-tr-cab time { font-variant-numeric: tabular-nums; }
    .mc-tr-cab a { margin-left: auto; color: var(--accent); font-weight: 700; text-decoration: none; }
    .mc-tr-cab a:hover { text-decoration: underline; }
    .mc-tr-chip { height: 20px; padding: 0 7px; border-radius: 6px; display: inline-flex; align-items: center; font-size: 11px; font-weight: 700; }
    .mc-tr-chip.is-pendiente { background: var(--int-soft); color: var(--int); }
    .mc-tr-chip.is-preparando { background: var(--warn-soft); color: var(--warn); }
    .mc-tr-chip.is-enviado { background: var(--ok-soft); color: var(--ok); }
    .mc-tr-art {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center;
      padding: 8px 12px; border-top: 1px solid var(--line-2);
    }
    .mc-tr-nom { font-size: 12.5px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mc-tr-u { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--ink-3); }
    .mc-tr-u span { text-decoration: underline dotted; cursor: help; }
    .mc-tr-est { grid-row: span 2; font-size: 11.5px; font-weight: 700; text-align: right; }
    .mc-tr-est.is-ok { color: var(--ok); }
    .mc-tr-est.is-espera { color: var(--int); }
    .mc-tr-est.is-parcial { color: var(--warn); }
    .mc-tr-est.is-falta { color: var(--bad); }

    /* Seleccion y filtro: lo que no corresponde se apaga */
    .mc-celda.is-dim { opacity: .28; }
    .mc-celda--vacia.is-dim { opacity: .45; }
    .mc-celda.is-sel { box-shadow: 0 0 0 2px var(--mc-tono), 0 12px 28px -10px color-mix(in srgb, var(--mc-tono) 60%, transparent); transform: translateY(-2px); }
    .mc-celda.is-cambio { animation: mcCambio 1s var(--ease-out); }
    @keyframes mcCambio {
      0% { box-shadow: 0 0 0 0 var(--mc-tono), var(--sh1); }
      30% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--mc-tono) 45%, transparent), var(--sh2); }
      100% { box-shadow: var(--sh1); }
    }
    .mc-grid.mc-entra .mc-celda { animation: mcEntra .5s var(--ease-out) both; animation-delay: calc(var(--mc-i, 0) * 16ms); }
    @keyframes mcEntra { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }

    /* Fuera del mapa */
    .mc-fuera {
      flex: none; display: flex; align-items: center; gap: 8px; overflow-x: auto;
      padding: 10px 20px; border-top: 1px solid var(--line-2); background: var(--surface);
      font-size: 12px; font-weight: 700; color: var(--ink-3);
    }
    .mc-fuera[hidden] { display: none; }
    .mc-fuera > span { flex: none; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .8px; text-transform: uppercase; }
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
      position: absolute; inset: 0; z-index: 5; background: rgba(0, 0, 0, .22);
      opacity: 0; pointer-events: none; transition: opacity .22s;
    }
    .mc-box.con-hoja .mc-velo { opacity: 1; pointer-events: auto; }
    .mc-hoja {
      position: absolute; left: 50%; bottom: 16px; z-index: 6;
      max-height: calc(100% - 32px); overflow-y: auto; overscroll-behavior: contain;
      width: min(440px, calc(100% - 28px)); padding: 22px 22px 18px;
      background: var(--surface); border-radius: var(--r3); box-shadow: var(--sh3);
      transform: translate(-50%, calc(100% + 30px)); visibility: hidden;
      transition: transform .38s cubic-bezier(.32, .72, 0, 1), visibility 0s linear .38s;
    }
    .mc-hoja.active { transform: translate(-50%, 0); visibility: visible; transition: transform .38s cubic-bezier(.32, .72, 0, 1), visibility 0s; }
    .mc-ficha::before {
      content: ''; position: absolute; left: 0; right: 0; top: 0; height: 4px;
      background: linear-gradient(90deg, var(--mc-tono) var(--mc-p), var(--int) var(--mc-p) var(--mc-q), var(--line-2) var(--mc-q));
    }
    .mc-hoja h4 { font-size: 18px; font-weight: 800; letter-spacing: -.4px; color: var(--ink); line-height: 1.25; }
    .mc-hoja-sub { margin-top: 4px; font-size: 12.5px; font-weight: 600; color: var(--ink-3); }
    .mc-ficha-celdas { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
    .mc-ficha-av {
      margin-top: 16px; padding: 14px 14px 12px; border-radius: var(--r2); background: var(--mc-soft);
      display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 10px 12px;
    }
    .mc-ficha-av b {
      font-family: var(--font-mono); font-size: 34px; font-weight: 700; letter-spacing: -1.6px; line-height: 1;
      color: color-mix(in srgb, var(--mc-tono) 85%, var(--ink));
    }
    .mc-ficha-av b small { font-size: 16px; letter-spacing: 0; opacity: .7; }
    .mc-ficha-av > span { font-size: 12.5px; font-weight: 600; color: var(--ink-2); text-align: right; }
    .mc-barra { grid-column: 1 / -1; height: 6px; border-radius: 6px; background: color-mix(in srgb, var(--mc-tono) 16%, var(--surface)); overflow: hidden; }
    .mc-barra { display: flex; }
    .mc-barra i { display: block; flex: none; height: 100%; width: var(--mc-p); background: var(--mc-tono); transition: width .6s var(--ease-out); }
    .mc-barra i.mc-barra-tr {
      width: calc(var(--mc-q) - var(--mc-p));
      background: repeating-linear-gradient(135deg, var(--int) 0 4px, color-mix(in srgb, var(--int) 60%, var(--surface)) 4px 8px);
    }
    .mc-ficha-desglose { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; font-weight: 600; color: var(--ink-2); }
    .mc-ficha-desglose span { display: inline-flex; align-items: center; gap: 6px; }
    .mc-ficha-desglose i { width: 9px; height: 9px; border-radius: 3px; background: var(--mc-tono); }
    .mc-ficha-desglose i.is-tr { background: var(--int); }
    .mc-ficha-desglose i.is-falta { background: var(--line); }
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
      .mc-head { padding: 14px 14px 14px; }
      .mc-resumen { gap: 4px 16px; margin-top: 12px; }
      .mc-stat b { font-size: 19px; }
      .mc-leyenda { padding: 10px 14px; }
      .mc-leyenda-ayuda { display: none; }
      .mc-grid {
        --mc-gap: 6px; padding: 0 12px 12px 0;
        grid-template-columns: 32px repeat(var(--mc-cols), minmax(112px, 1fr));
        grid-auto-rows: max(78px, calc((100cqh - 36px - 4 * var(--mc-gap) - 12px) / 4));
      }
      .mc-pct { font-size: 18px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .mc-celda, .mc-hoja, .mc-velo, .mc-barra i { transition: none; }
      .mc-grid.mc-entra .mc-celda, .mc-celda.is-cambio, .mc-tira i, .mc-vivo i::after, .mc-tr--espera svg { animation: none; }
    }
  `;

  const IC_GRILLA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"></rect><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"></rect><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"></rect><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"></rect></svg>';
  const IC_AJUSTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="17" x2="20" y2="17"></line><circle cx="9" cy="7" r="2.4" fill="var(--surface)"></circle><circle cx="15" cy="17" r="2.4" fill="var(--surface)"></circle></svg>';
  const IC_CERRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>';
  const IC_CAMION = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 6.5h11v10h-11z"></path><path d="M13.5 9.5h4l3.5 3.5v3.5h-7.5"></path><circle cx="6.5" cy="17.5" r="1.7"></circle><circle cx="17" cy="17.5" r="1.7"></circle></svg>';
  const IC_CHECK ='<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  const HTML = `
    <div class="mc-box" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="mcTitulo">
      <div class="mc-head">
        <div class="mc-head-fila">
          <span class="mc-head-ic">${IC_GRILLA}</span>
          <div class="mc-title">
            <h3 id="mcTitulo">Mapa de casillas</h3>
            <span class="mc-vivo" id="mcVivo"><i></i><span>En vivo</span></span>
          </div>
          <button type="button" class="mc-btn-ic" id="mcBtnAjustar" title="Tamaño del depósito" aria-label="Tamaño del depósito">${IC_AJUSTE}</button>
          <button type="button" class="mc-btn-ic" id="mcBtnCerrar" title="Cerrar" aria-label="Cerrar">${IC_CERRAR}</button>
        </div>
        <div class="mc-resumen" id="mcResumen" aria-live="polite">Cargando...</div>
        <div class="mc-tira" id="mcTira" aria-hidden="true"></div>
      </div>
      <div class="mc-leyenda" id="mcLeyenda" role="toolbar" aria-label="Resaltar pedidos por estado">
        <button type="button" class="mc-filtro mc-t-nuevo" data-filtro="nuevo" aria-pressed="false"><i></i>Sin empezar<span data-cnt="nuevo">0</span></button>
        <button type="button" class="mc-filtro mc-t-armando" data-filtro="armando" aria-pressed="false"><i></i>Armando<span data-cnt="armando">0</span></button>
        <button type="button" class="mc-filtro mc-t-completo" data-filtro="completo" aria-pressed="false"><i></i>Completo<span data-cnt="completo">0</span></button>
        <button type="button" class="mc-filtro mc-t-controlado" data-filtro="controlado" aria-pressed="false">${IC_CHECK}Controlado<span data-cnt="controlado">0</span></button>
        <i class="mc-leyenda-sep"></i>
        <button type="button" class="mc-filtro mc-f-tr" data-filtro="traspaso" aria-pressed="false" title="Pedidos con mercadería pedida a Caseros que todavía no llegó">${IC_CAMION}Esperando traspaso<span data-cnt="traspaso">0</span></button>
        <span class="mc-leyenda-ayuda">Tocá un estado para resaltarlo</span>
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
  let vivo = null;            // { snaps, subs }
  let pintarTimer = null;
  let pedidos = [];           // pedidos con casillas, ya resumidos
  let porCelda = new Map();   // 'C4' -> [pedido...]
  let firmas = new Map();     // 'C4' -> firma pintada
  let gridClave = '';         // rango de la cuadricula armada
  let seleccion = null;       // id del pedido elegido
  let filtro = null;          // estado resaltado desde la leyenda

  // Misma clave que usan Articulos necesarios y Traspasos para cada codigo.
  const claveSegura = (codigo) => String(codigo).replace(/[.#$\/\[\]]/g, '_');
  const TR_ESTADOS = { PENDIENTE: 'Pendiente', PREPARANDO: 'Preparando', ENVIADO: 'Enviado' };
  const linkTraspaso = (id) => new URL('../Traspasos/index.html?tr=' + encodeURIComponent(id), location.href).href;
  const fechaCorta = (ts) => ts
    ? new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

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
    if (local) { config = local; }
    try {
      const snap = await conTimeout(() => db.ref(RUTA_CONFIG).once('value'));
      const remota = normalizar(snap.val());
      if (remota) { config = remota; escribirLocal(remota); }
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
      timestamp: p.timestamp || 0,
      // Lineas por articulo, para cruzarlas con los traspasos.
      lineas: validos.map(it => {
        const codigo = it.codigo || 'SIN_CODIGO';
        return { k: claveSegura(codigo), nombre: it.nombre || codigo, cantidad: parseInt(it.cantidad, 10) || 0, listo: it.listo === 'y' };
      }),
      tr: [],
      trEstado: '',
      pctTr: 0      // parte del pedido que ya se pidio a Caseros (sin empacar)
    };
  }

  // ------------------------------------------
  // TRASPASOS DE CASEROS
  // ------------------------------------------
  // Los traspasos creados desde Articulos necesarios (fuente 'pedidos')
  // anotan en cubre/<clave>/<pedidoId> cuantas unidades son para cada pedido.
  // Los que no lo tienen (anteriores a ese dato, o articulos agregados despues
  // en la app Traspasos) se toman, igual que en necesarios, como pedidos para
  // los pedidos que ya existian al crearlos: esos quedan marcados "estimado".
  // Si Caseros envio menos de lo pedido, lo que llego se reparte primero entre
  // los pedidos mas antiguos.
  function asociarTraspasos(lista) {
    lista.forEach(p => { p.tr = []; p.trEstado = ''; });
    if (!vivo || !vivo.tr) return;
    const porId = new Map(lista.map(p => [p.id, p]));
    vivo.tr.forEach(ch => {
      const t = ch.val();
      if (!t || t.fuente !== 'pedidos') return;
      const estado = t.estado === 'RECIBIDO' ? 'ENVIADO' : t.estado;
      if (estado !== 'PENDIENTE' && estado !== 'PREPARANDO' && estado !== 'ENVIADO') return;
      Object.keys(t.items || {}).forEach(k => {
        const it = t.items[k] || {};
        const cubre = t.cubre && t.cubre[k];
        const asig = [];
        if (cubre) {
          Object.keys(cubre).forEach(pid => {
            const p = porId.get(pid);
            const u = Number(cubre[pid]) || 0;
            if (p && u > 0) asig.push({ p, u, estimado: false });
          });
        } else {
          lista.forEach(p => {
            if ((p.timestamp || 0) > (t.creadoEn || 0)) return;
            const u = p.lineas.filter(l => l.k === k && !l.listo).reduce((s, l) => s + l.cantidad, 0);
            if (u > 0) asig.push({ p, u, estimado: true });
          });
        }
        asig.sort((a, b) => (a.p.timestamp || 0) - (b.p.timestamp || 0));
        let quedan = Number(it.enviada) || 0;
        asig.forEach(a => {
          const lineas = a.p.lineas.filter(l => l.k === k);
          if (!lineas.length) return; // ya no esta en el pedido
          let llega = null;
          if (estado === 'ENVIADO') { llega = Math.min(a.u, Math.max(0, quedan)); quedan -= llega; }
          a.p.tr.push({
            k: k, id: ch.key, numero: t.numero || 'TR', estado: estado,
            creadoEn: t.creadoEn || 0, enviadoEn: t.enviadoEn || 0,
            nombre: it.nombre || lineas[0].nombre, unidades: a.u, llega: llega, motivo: it.motivo || '',
            estimado: a.estimado, empacado: lineas.every(l => l.listo)
          });
        });
      });
    });
    lista.forEach(p => { p.trEstado = estadoTr(p.tr); p.pctTr = pctTraspaso(p); });
  }

  // Que porcentaje del pedido (medido igual que el armado: por linea) cubre
  // la mercaderia pedida a Caseros que todavia no se empaco. Cuenta lo que
  // esta pedido o en preparacion y, de lo ya enviado, solo lo que llego: lo
  // que Caseros no mando vuelve a ser faltante. Una linea cubierta en parte
  // suma en proporcion. Nunca pasa de lo que le falta al armado.
  function pctTraspaso(p) {
    if (!p.total || p.controlado || !p.tr.length) return 0;
    const enCamino = new Map();
    p.tr.forEach(a => {
      if (a.empacado) return;
      const u = a.estado === 'ENVIADO' ? (a.llega || 0) : a.unidades;
      if (u > 0) enCamino.set(a.k, (enCamino.get(a.k) || 0) + u);
    });
    let cubiertas = 0;
    enCamino.forEach((u, k) => {
      const pend = p.lineas.filter(l => l.k === k && !l.listo);
      if (!pend.length) return;
      const unid = pend.reduce((s, l) => s + l.cantidad, 0);
      cubiertas += pend.length * (unid > 0 ? Math.min(1, u / unid) : 1);
    });
    const pct = Math.round(cubiertas / p.total * 100);
    return Math.max(0, Math.min(100 - p.pct, pct));
  }

  // espera: hay mercaderia en camino que el pedido todavia necesita.
  // falta: Caseros mando menos de lo pedido. llego: ya esta todo para armar.
  function estadoTr(arr) {
    const rel = arr.filter(a => !a.empacado);
    if (!rel.length) return '';
    if (rel.some(a => a.estado !== 'ENVIADO')) return 'espera';
    if (rel.some(a => a.llega < a.unidades)) return 'falta';
    return 'llego';
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
    asociarTraspasos(lista);
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
        marcarVivo(true);
        if (!v.snaps.ABIERTO || !v.snaps.CERRADO) return;
        clearTimeout(pintarTimer);
        pintarTimer = setTimeout(() => { reconstruir(); pintar(); }, PAUSA_MS);
      }, err => {
        if (vivo !== v) return;
        console.error('Mapa de casillas: error escuchando pedidos', err);
        document.getElementById('mcResumen').textContent = 'Sin conexión: no se pudo cargar el mapa';
        marcarVivo(false);
      });
      v.subs.push([q, cb]);
    });
    // Traspasos: misma consulta que Articulos necesarios (los ultimos 100).
    // Si el usuario no tiene acceso, el mapa sigue sin esa informacion.
    const qTr = db.ref('traspasos').limitToLast(100);
    const cbTr = qTr.on('value', snap => {
      if (vivo !== v) return;
      v.tr = snap;
      v.trError = false;
      if (!v.snaps.ABIERTO || !v.snaps.CERRADO) return;
      clearTimeout(pintarTimer);
      pintarTimer = setTimeout(() => { reconstruir(); pintar(); }, PAUSA_MS);
    }, err => {
      if (vivo !== v) return;
      console.warn('Mapa de casillas: no se pudieron leer los traspasos', err);
      v.tr = null;
      v.trError = true;
      if (v.snaps.ABIERTO && v.snaps.CERRADO) { reconstruir(); pintar(); }
    });
    v.subs.push([qTr, cbTr]);
  }

  function marcarVivo(ok) {
    const el = document.getElementById('mcVivo');
    if (!el) return;
    el.classList.toggle('is-off', !ok);
    el.lastElementChild.textContent = ok ? 'En vivo' : 'Sin conexión';
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
    if (p.estado === 'controlado') return '<span class="mc-pct mc-pct--ok" title="Controlado">' + IC_CHECK + '</span>';
    return '<span class="mc-pct">' + p.pct + '<small>%</small>' +
      (p.pctTr ? '<span class="mc-pct-tr" title="' + p.pctTr + '% pedido a Caseros">+' + p.pctTr + '</span>' : '') + '</span>';
  }

  // Estado de traspaso de la casilla: el mas urgente entre sus pedidos.
  const TR_PRIORIDAD = { espera: 3, falta: 2, llego: 1 };
  function trCelda(lista) {
    let estado = '';
    lista.forEach(p => { if ((TR_PRIORIDAD[p.trEstado] || 0) > (TR_PRIORIDAD[estado] || 0)) estado = p.trEstado; });
    if (!estado) return null;
    const numeros = [];
    lista.forEach(p => p.tr.forEach(a => {
      if (a.empacado || numeros.includes(a.numero)) return;
      if (estado === 'espera' ? a.estado === 'ENVIADO' : a.estado !== 'ENVIADO') return;
      numeros.push(a.numero);
    }));
    return { estado: estado, numeros: numeros };
  }

  const TR_TITULO = {
    espera: 'Esperando mercadería de Caseros',
    falta: 'Caseros envió menos de lo pedido',
    llego: 'Llegó la mercadería de Caseros'
  };
  function trBadge(tr, compacto) {
    const txt = compacto ? '' : (tr.numeros.length === 1 ? tr.numeros[0] : tr.numeros.length + ' TR');
    return '<span class="mc-tr mc-tr--' + tr.estado + '" title="' + escapeHtml(TR_TITULO[tr.estado] + ' (' + tr.numeros.join(', ') + ')') + '">' +
      IC_CAMION + (txt ? '<span>' + escapeHtml(txt) + '</span>' : '') + '</span>';
  }

  function contenidoCelda(celda, lista) {
    if (!lista || !lista.length) {
      return { clase: 'mc-celda mc-celda--vacia', p: 0, html: '<span class="mc-coord">' + celda + '</span>', firma: '' };
    }
    const p = lista[0];
    const multi = lista.length > 1;
    let html = '<span class="mc-cab"><span class="mc-coord">' + celda + '</span>';
    const tr = trCelda(lista);
    if (tr) html += trBadge(tr, multi);
    if (multi) html += '<span class="mc-multi" title="Hay ' + lista.length + ' pedidos en esta casilla">×' + lista.length + '</span>';
    html += '</span>';
    html += '<span class="mc-nombre">' + escapeHtml(p.nombre) + '</span>';
    if (multi) html += '<span class="mc-sub">+ ' + lista.slice(1).map(x => escapeHtml(x.nombre)).join(', ') + '</span>';
    else if (p.celdas.length > 1) html += '<span class="mc-sub">Ocupa ' + p.celdas.length + ' casillas</span>';
    html += '<span class="mc-pie">' + htmlPct(p) +
      '<span class="mc-items">' + (p.total ? p.listos + '/' + p.total : 'sin ítems') + '</span></span>';
    return {
      clase: 'mc-celda mc-celda--ocupada mc-t-' + p.estado + (multi ? ' mc-celda--multi' : '') + (p.pctTr ? ' mc-con-tr' : ''),
      p: p.estado === 'controlado' ? 100 : p.pct,
      q: p.estado === 'controlado' ? 100 : p.pct + p.pctTr,
      html: html,
      estado: p.estado,
      tr: tr ? tr.estado : '',
      firma: lista.map(x => x.id + ':' + x.nombre + ':' + x.listos + '/' + x.total + ':' + x.estado + ':' + x.celdas.length + ':' + x.pctTr).join('|') +
        (tr ? '#' + tr.estado + ':' + tr.numeros.join(',') : ''),
      ids: lista.map(x => x.id)
    };
  }

  function armarGrilla(cfg) {
    const cols = cfg.c2 - cfg.c1 + 1;
    grid.style.setProperty('--mc-cols', cols);
    let h = '<div class="mc-esq"></div>';
    for (let c = cfg.c1; c <= cfg.c2; c++) h += '<div class="mc-hcol"><b>' + celdaColTxt(c) + '</b></div>';
    let i = 0;
    for (let f = cfg.f1; f <= cfg.f2; f++) {
      h += '<div class="mc-hfila"><b>' + f + '</b></div>';
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
        nodo.dataset.estado = d.estado;
        if (d.tr) nodo.dataset.tr = d.tr; else delete nodo.dataset.tr;
        const p = porCelda.get(celda)[0];
        nodo.setAttribute('aria-label', 'Casilla ' + celda + ': ' + p.nombre + ', ' +
          (p.controlado ? 'controlado' : p.pct + '% armado' + (p.pctTr ? ', ' + p.pctTr + '% pedido a Caseros' : '')));
        // Primero sin avance y en el cuadro siguiente el valor real: asi el
        // relleno sube con la transicion en lugar de aparecer de golpe.
        if (firmaVieja === undefined || firmaVieja === '') {
          nodo.style.setProperty('--mc-p', '0%');
          nodo.style.setProperty('--mc-q', '0%');
          requestAnimationFrame(() => requestAnimationFrame(() => {
            nodo.style.setProperty('--mc-p', d.p + '%');
            nodo.style.setProperty('--mc-q', d.q + '%');
          }));
        } else {
          nodo.style.setProperty('--mc-p', d.p + '%');
          nodo.style.setProperty('--mc-q', d.q + '%');
        }
        if (!primera && firmaVieja !== undefined) {
          nodo.classList.add('is-cambio');
          setTimeout(() => nodo.classList.remove('is-cambio'), 950);
        }
      } else {
        delete nodo.dataset.ids;
        delete nodo.dataset.estado;
        delete nodo.dataset.tr;
        nodo.removeAttribute('aria-label');
        nodo.style.removeProperty('--mc-p');
        nodo.style.removeProperty('--mc-q');
      }
      firmas.set(celda, d.firma);
    });

    aplicarSeleccion();
    pintarResumen(cfg);
    pintarFuera(cfg);
    if (seleccion) pintarFicha(seleccion);
  }

  function pintarResumen(cfg) {
    const totalCasillas = (cfg.c2 - cfg.c1 + 1) * (cfg.f2 - cfg.f1 + 1);
    let ocupadas = 0;
    porCelda.forEach((_, c) => { if (dentro(c, cfg)) ocupadas++; });
    const n = pedidos.length;
    const cuenta = { nuevo: 0, armando: 0, completo: 0, controlado: 0 };
    pedidos.forEach(p => { cuenta[p.estado]++; });
    cuenta.traspaso = pedidos.filter(p => p.trEstado === 'espera').length;
    const listos = cuenta.completo + cuenta.controlado;
    const libres = Math.max(0, totalCasillas - ocupadas);
    const pctOcup = totalCasillas ? Math.round(ocupadas / totalCasillas * 100) : 0;
    document.getElementById('mcResumen').innerHTML =
      '<span class="mc-stat mc-stat--pct"><b>' + pctOcup + '<small>%</small></b>ocupado</span>' +
      '<span class="mc-stat"><b>' + ocupadas + '<small>/' + totalCasillas + '</small></b>casillas</span>' +
      '<span class="mc-stat"><b>' + libres + '</b>' + (libres === 1 ? 'libre' : 'libres') + '</span>' +
      '<span class="mc-stat"><b>' + n + '</b>' + (n === 1 ? 'pedido' : 'pedidos') + '</span>' +
      '<span class="mc-stat"><b>' + listos + '</b>' + (listos === 1 ? 'listo' : 'listos') + '</span>';
    Object.keys(cuenta).forEach(k => {
      const el = panel.querySelector('[data-cnt="' + k + '"]');
      if (el) el.textContent = cuenta[k];
    });
    pintarTira(cfg, totalCasillas);
  }

  // Una marca por casilla recorriendo el mapa fila por fila.
  function pintarTira(cfg, totalCasillas) {
    const el = document.getElementById('mcTira');
    let h = '', i = 0;
    for (let f = cfg.f1; f <= cfg.f2; f++) {
      for (let c = cfg.c1; c <= cfg.c2; c++) {
        const lista = porCelda.get(celdaColTxt(c) + f);
        h += '<i class="' + (lista ? 'mc-t-' + lista[0].estado : 'mc-libre') + '" style="--mc-i:' + Math.min(i++, 60) + '"></i>';
      }
    }
    if (el.dataset.firma === h) return;
    el.dataset.firma = h;
    el.classList.toggle('is-densa', totalCasillas > 80);
    el.innerHTML = h;
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

  // La seleccion de un pedido manda; si no hay, se aplica el filtro de la leyenda.
  function aplicarSeleccion() {
    grid.querySelectorAll('.mc-celda').forEach(el => {
      const ids = (el.dataset.ids || '').split(',');
      const sel = !!seleccion && ids.includes(seleccion);
      const coincide = filtro === 'traspaso' ? el.dataset.tr === 'espera' : el.dataset.estado === filtro;
      const dim = seleccion ? !sel : (filtro ? !coincide : false);
      el.classList.toggle('is-sel', sel);
      el.classList.toggle('is-dim', dim);
    });
    if (panel) panel.querySelectorAll('.mc-filtro').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.filtro === filtro)));
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
    const pp = p.controlado ? 100 : p.pct;
    const falta = Math.max(0, 100 - pp - p.pctTr);
    el.style.cssText = '--mc-p:' + pp + '%;--mc-q:' + (pp + p.pctTr) + '%';
    el.innerHTML =
      '<h4 id="mcFichaNombre">' + escapeHtml(p.nombre) + '</h4>' +
      '<div class="mc-hoja-sub">Pedido ' + escapeHtml(p.id) + ' · ' + String(p.status || '').toLowerCase() + '</div>' +
      '<div class="mc-ficha-celdas">' + p.celdas.map(c => '<span class="celda-chip">' + c + '</span>').join('') + '</div>' +
      '<div class="mc-ficha-av"><b>' + p.pct + '<small>%</small></b><span>' + p.listos + ' de ' + p.total + ' empacados</span>' +
      '<div class="mc-barra"><i></i>' + (p.pctTr ? '<i class="mc-barra-tr"></i>' : '') + '</div>' +
      (p.pctTr ? '<div class="mc-ficha-desglose">' +
        '<span><i></i>' + pp + '% armado</span>' +
        '<span><i class="is-tr"></i>' + p.pctTr + '% pedido a Caseros</span>' +
        '<span><i class="is-falta"></i>' + falta + '% falta</span></div>' : '') +
      '</div>' +
      '<div class="mc-ficha-tags">' + tags.join('') + '</div>' +
      fichaTraspasos(p) +
      '<div class="modal-btns">' +
        '<button type="button" class="btn-cancel" data-accion="cerrar">Cerrar</button>' +
        '<button type="button" class="btn-primary" data-accion="abrir">Abrir pedido</button>' +
      '</div>';
  }

  // Estado de un articulo del traspaso para este pedido: [clase, texto].
  function estadoArtTr(a) {
    if (a.empacado) return ['ok', 'Empacado'];
    if (a.estado === 'PENDIENTE') return ['espera', 'Pedido a Caseros'];
    if (a.estado === 'PREPARANDO') return ['espera', 'Caseros lo prepara'];
    if (a.llega >= a.unidades) return ['ok', 'Llegó'];
    if (a.llega > 0) return ['parcial', 'Llegaron ' + a.llega + ' de ' + a.unidades];
    return ['falta', a.motivo === 'SIN_STOCK' ? 'Sin stock en Caseros' : 'No se envió'];
  }

  function fichaTraspasos(p) {
    if (vivo && vivo.trError) {
      return '<div class="mc-trs"><div class="mc-trs-aviso">No se pudieron leer los traspasos. Revisá la conexión o que tu usuario tenga acceso a Traspasos.</div></div>';
    }
    if (!p.tr.length) return '';
    const grupos = new Map();
    p.tr.forEach(a => {
      if (!grupos.has(a.id)) grupos.set(a.id, []);
      grupos.get(a.id).push(a);
    });
    const orden = [...grupos.values()].sort((x, y) => y[0].creadoEn - x[0].creadoEn);
    return '<div class="mc-trs"><div class="mc-trs-tit">' + IC_CAMION + 'Mercadería pedida a Caseros</div>' +
      orden.map(arts => {
        const t = arts[0];
        const fecha = fechaCorta(t.estado === 'ENVIADO' ? t.enviadoEn : t.creadoEn);
        return '<div class="mc-tr-grupo">' +
          '<div class="mc-tr-cab"><b>' + escapeHtml(t.numero) + '</b>' +
            '<span class="mc-tr-chip is-' + t.estado.toLowerCase() + '">' + TR_ESTADOS[t.estado] + '</span>' +
            (fecha ? '<time>' + fecha + '</time>' : '') +
            '<a href="' + escapeHtml(linkTraspaso(t.id)) + '" target="_blank" rel="noopener">Ver en Traspasos</a></div>' +
          arts.map(a => {
            const [cls, txt] = estadoArtTr(a);
            return '<div class="mc-tr-art"><span class="mc-tr-nom">' + escapeHtml(a.nombre) + '</span>' +
              '<span class="mc-tr-est is-' + cls + '">' + escapeHtml(txt) + '</span>' +
              '<span class="mc-tr-u">' + a.unidades + ' u.' +
              (a.estimado ? ' · <span title="Este traspaso no detalla a qué pedido va cada unidad: se asume para los pedidos que ya existían al crearlo.">estimado</span>' : '') +
              '</span></div>';
          }).join('') +
        '</div>';
      }).join('') + '</div>';
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

    document.getElementById('mcLeyenda').addEventListener('click', e => {
      const b = e.target.closest('.mc-filtro');
      if (!b) return;
      filtro = filtro === b.dataset.filtro ? null : b.dataset.filtro;
      if (seleccion) cerrarFicha(); else aplicarSeleccion();
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
    filtro = null;
    gridClave = '';
    firmas = new Map();
    cerrarFicha();
    cerrarConfig();
    grid.innerHTML = '<div class="mc-estado"><div class="spinner"></div>Cargando el mapa...</div>';
    document.getElementById('mcResumen').textContent = 'Cargando...';
    document.getElementById('mcFuera').hidden = true;
    const tira = document.getElementById('mcTira');
    tira.innerHTML = '';
    tira.dataset.firma = '';
    marcarVivo(true);
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
