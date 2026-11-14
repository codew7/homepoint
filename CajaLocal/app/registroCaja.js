/* =============================================================================
   registroCaja.js - Registro diario de lo que se hace en la caja
   =============================================================================
   Solo actúa en el programa de escritorio (CajaLocal): cada evento se manda al
   programa (window.cajaApp.registro, ver CajaLocal/electron/registro.js), que lo
   escribe en un .txt por día en %APPDATA%\Caja HomePoint\registro\.
   En la web no hace nada: no existe window.cajaApp.

   Uso desde las pantallas:
     Registro.anotar('ARTÍCULO', '+ Agregó 2 × Taza ...', ['renglón extra', ...]);
     Registro.plata(1234)        -> "$ 1.234"
     Registro.linea(item)        -> "2 × Taza 350ml [7791234567890] a $ 4.200 = $ 8.400"
     Registro.resumen(items)     -> "3 art. / 5 u · $ 21.150"

   El usuario activo y la pantalla se completan solos. NUNCA anotar
   contraseñas ni el texto de los mensajes del chat.
   ========================================================================== */
(function () {
  'use strict';

  const puente = window.cajaApp && window.cajaApp.registro;
  const activo = !!(puente && typeof puente.anotar === 'function');

  function pantalla() {
    const archivo = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
    if (/^ingresoPedido/i.test(archivo)) return 'Caja';
    if (/^historial/i.test(archivo)) return 'Historial';
    return archivo || 'Caja';
  }

  function usuario() {
    try {
      const u = window.UsuarioActivo && UsuarioActivo.actual && UsuarioActivo.actual();
      if (u) return String(u);
    } catch (_) {}
    return '';
  }

  function plata(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '-$ ' : '$ ') + Math.abs(v).toLocaleString('es-AR');
  }

  function signo(it) {
    if (!it || !it.tipoLinea || it.tipoLinea === 'VENTA') return 1;
    return it.tipoLinea === 'DEVOLUCION' ? -1 : 0;
  }

  // Un renglón de la venta, en una línea.
  function linea(it) {
    if (!it) return '';
    const cant = parseInt(it.cantidad, 10) || 0;
    const valorU = parseInt(it.valorU, 10) || 0;
    const codigo = it.codigoBarras || it.codigo || '';
    const tipo = it.tipoLinea && it.tipoLinea !== 'VENTA' ? ` (${it.tipoLinea === 'GARANTIA' ? 'GARANTÍA' : 'DEVOLUCIÓN'})` : '';
    return `${cant} × ${it.nombre || '(sin nombre)'}${codigo ? ' [' + codigo + ']' : ''}${tipo} a ${plata(valorU)} = ${plata(signo(it) * cant * valorU)}`;
  }

  function resumen(items) {
    const lista = Array.isArray(items) ? items : [];
    const unidades = lista.reduce((a, it) => a + (parseInt(it.cantidad, 10) || 0), 0);
    const total = lista.reduce((a, it) => a + signo(it) * (parseInt(it.cantidad, 10) || 0) * (parseInt(it.valorU, 10) || 0), 0);
    return `${lista.length} art. / ${unidades} u · ${plata(total)}`;
  }

  function anotar(categoria, texto, detalle) {
    if (!activo) return;
    try {
      puente.anotar({
        categoria: String(categoria || 'OTRO'),
        texto: `[${pantalla()}] ${texto == null ? '' : String(texto)}`,
        detalle: Array.isArray(detalle) ? detalle.map(String) : undefined,
        usuario: usuario()
      });
    } catch (_) {}
  }

  window.Registro = { activo, anotar, plata, linea, resumen };

  if (!activo) return;

  // Pantalla abierta / cerrada. pagehide corre también al recargar o al pasar
  // a otra pantalla de la caja.
  anotar('PANTALLA', 'Se abrió la pantalla' + (location.search ? ' (' + location.search + ')' : ''));
  window.addEventListener('pagehide', () => anotar('PANTALLA', 'Se cerró la pantalla'));

  // Errores de la página que nadie atrapó: sirven para entender qué pasó.
  window.addEventListener('error', (e) => {
    if (e && e.message) anotar('ERROR', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno || 0})`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    anotar('ERROR', 'Promesa sin atender: ' + (r && r.message ? r.message : String(r)));
  });
})();
