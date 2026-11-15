/* =============================================================================
   registroAnalisis.js - Lectura y análisis del registro diario de la caja
   =============================================================================
   Un solo original para las dos pantallas que muestran el registro:
     · el visor local de la caja de escritorio
       (CajaLocal/electron/visor-registro.html, 5 clics en la versión);
     · el panel web "Actividad de las cajas" (actividadCajas.html), que junta
       los registros que suben todos los equipos.

   Sólo lee texto y devuelve datos: no toca la pantalla ni la red.

   Depende del texto EXACTO de los renglones que escriben ingresoPedidoV2.js,
   historialRecientes.html, usuarioActivo.js y chat.js (`✖ DESCARTADO (...)`,
   `✔ INGRESADO ticket X`, `Medio de pago: X`, `− Eliminó`, `~ Precio de`,
   `Total $ X`, `· Vendedor`): si se cambia cómo se anota una acción, revisar
   las expresiones de acá.

   Varios equipos a la vez: si cada evento trae `eq` (el equipo), los
   "pedidos en pantalla" se arman por equipo y ventana, así V1 de una PC no
   se mezcla con V1 de otra. Los tickets sí se cruzan entre equipos del mismo
   punto de venta (un pedido cobrado en una PC y cancelado en otra).
   ========================================================================== */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.RegistroAnalisis = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const RAPIDOS = [
  { id: 'ingresados', nombre: 'Pedidos ingresados', clase: 'ok',
    prueba: (e) => e.cat === 'PEDIDO' && /✔ (INGRESADO|MODIFICADO|GUARDADO)/.test(e.texto) },
  { id: 'descartados', nombre: 'Descartados', clase: 'mal',
    prueba: (e) => e.cat === 'PEDIDO' && /DESCARTADO/.test(e.texto) },
  { id: 'eliminados', nombre: 'Artículos eliminados', clase: '',
    prueba: (e) => e.cat === 'ARTÍCULO' && /Eliminó/.test(e.texto) },
  { id: 'noEncontrados', nombre: 'Códigos no encontrados', clase: '',
    prueba: (e) => e.cat === 'ESCANEO' && /SIN COINCIDENCIAS|no encontr/i.test(e.texto) },
  { id: 'errores', nombre: 'Errores', clase: 'mal',
    prueba: (e) => e.cat === 'ERROR' || /✖ NO SE GUARDÓ|Error/.test(e.texto) }
];

// ---------------------------------------------------------------- lectura
// Formato de cada renglón (registro.js):
//   HH:MM:SS  V1   usuario(12)   CATEGORÍA(11)  texto
//   <sangría>· detalle
function interpretar(texto) {
  const salida = [];
  let pc = '';
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim() || /^=+$/.test(linea)) continue;
    if (/^ Caja HomePoint /.test(linea)) { pc = linea.trim(); continue; }
    if (/^\s+· /.test(linea)) {
      const ultimo = salida[salida.length - 1];
      if (ultimo) ultimo.detalle.push(linea.replace(/^\s+· /, ''));
      continue;
    }
    if (!/^\d\d:\d\d:\d\d  /.test(linea)) continue;
    let resto = linea.slice(42);
    let pantalla = '';
    const m = /^\[(Caja|Historial)\] /.exec(resto);
    if (m) { pantalla = m[1]; resto = resto.slice(m[0].length); }
    salida.push({
      hora: linea.slice(0, 8),
      ventana: linea.slice(10, 13).trim(),
      usuario: linea.slice(15, 27).trim(),
      cat: linea.slice(29, 40).trim(),
      pantalla,
      texto: resto,
      detalle: []
    });
  }
  return { eventos: salida, pc };
}

function nombreDia(dia, largo) {
  const [a, m, d] = dia.split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  return fecha.toLocaleDateString('es-AR', largo
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'short', day: '2-digit', month: '2-digit' });
}

// =================================================== OPERACIONES SOSPECHOSAS
// Se recorre el registro en orden, ventana por ventana, armando cada
// "pedido en pantalla" desde el primer artículo hasta que se guarda (✔) o se
// descarta (✖). Con eso se buscan las maniobras típicas para entregar
// mercadería sin cobrarla o quedarse con la plata. Son indicios: el visor
// sólo los muestra, no cambia nada.
const PESO = { alta: 3, media: 2, baja: 1 };
const NOMBRE_SEV = { alta: 'GRAVE', media: 'MEDIA', baja: 'LEVE' };
const CATS_PEDIDO = new Set(['ARTÍCULO', 'ESCANEO', 'COBRO', 'CLIENTE', 'PEDIDO', 'IMPRESIÓN', 'CAMBIOS', 'MODO', 'AVISO']);
const CONF_DEFECTO = { monto: 100000, descuento: 15, descartes: 3 };

function plataANum(s) {
  const m = /(-?)\$ ?([\d.]+)/.exec(String(s || ''));
  return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, '')) : 0;
}
function fmt(n) { return (n < 0 ? '-$ ' : '$ ') + Math.abs(Math.round(n)).toLocaleString('es-AR'); }
function totalDe(e) {
  let m = /Total (-?\$ ?[\d.]+)/.exec(e.texto);
  if (m) return plataANum(m[1]);
  m = /\d+ art\. \/ -?\d+ u · (-?\$ ?[\d.]+)/.exec(e.texto);
  return m ? plataANum(m[1]) : 0;
}
function unidadesDe(e) { const m = /\d+ art\. \/ (-?\d+) u/.exec(e.texto); return m ? Number(m[1]) : 0; }
function articulosDe(e) { const m = /(\d+) art\. \//.exec(e.texto); return m ? Number(m[1]) : 0; }
function codigosDe(e) {
  const s = new Set();
  e.detalle.forEach((d) => { const m = /\[([^\]]+)\]/.exec(d); if (m) s.add(m[1]); });
  return s;
}
function ticketDe(e) { const m = /(?:ticket|pedido) ([A-Za-z0-9_-]{4,})/.exec(e.texto); return m ? m[1] : ''; }
function medioDe(e) {
  const partes = e.texto.split(' · ');
  const i = partes.findIndex((p) => p.startsWith('Vendedor'));
  return i > 0 ? partes[i - 1] : '';
}
function cuando(e) { return e.hora.slice(0, 5); }

function analizar(evs, conf) {
  const alertas = [];
  function alerta(sev, tipo, e, texto, contexto) {
    alertas.push({ sev, tipo, usuario: e.usuario, dia: e.dia, hora: e.hora, t: e.t, ventana: e.ventana, eq: e.eq,
      texto, clave: e, contexto: contexto && contexto.length ? contexto : [e] });
  }

  const sesiones = new Map();      // día|ventana → pedido en pantalla
  const guardados = new Map();     // ticket → último ✔ de ese ticket
  const descartes = [];            // para "lo rehízo más barato"
  const descartesDia = new Map();  // usuario|día → [descartes]
  const claves = new Map();        // usuario → horas de contraseñas incorrectas

  const nueva = () => ({ eventos: [], medio: '', ingresar: false, cobro: null, aviso: '',
    eliminados: [], elimMonto: 0, elimTrasCobro: [], precios: [], cantTrasCobro: [], manual: 0,
    noImprimir: false, descPct: 0, nuevo: false });

  function contrasenaMal(e) {
    const lista = (claves.get(e.usuario) || []).filter((t) => e.t - t < 10 * 60000);
    lista.push(e.t);
    claves.set(e.usuario, lista);
    if (lista.length === 2) alerta('baja', 'Contraseñas incorrectas seguidas', e,
      'Puso mal una contraseña dos veces en menos de 10 minutos.');
    if (lista.length === 3) alerta('media', 'Contraseñas incorrectas seguidas', e,
      'Puso mal una contraseña 3 veces o más en menos de 10 minutos: puede estar probando claves.');
  }

  function cerrarDescarte(s, e) {
    const total = totalDe(e), uds = unidadesDe(e), arts = articulosDe(e);
    const motivo = (/DESCARTADO \(([^)]+)\)/.exec(e.texto) || [])[1] || '';
    const ctx = s.eventos;
    const d = { e, total, codigos: codigosDe(e) };
    descartes.push(d);
    const k = e.usuario + '|' + e.dia;
    descartesDia.set(k, (descartesDia.get(k) || []).concat(e));
    const perdido = `${arts} artículo${arts === 1 ? '' : 's'} / ${uds} u por ${fmt(total)}`;

    if (s.cobro) {
      const sev = s.aviso ? 'media' : 'alta';
      alerta(sev, 'Preparó el cobro y descartó el pedido', e,
        `${s.medio ? `Eligió el medio de pago “${s.medio}”` : 'Empezó a cobrar'}${s.ingresar ? ' y presionó Ingresar Orden' : ''}, ` +
        `pero en vez de guardar el pedido lo descartó (${motivo}). Quedaron sin registrar ${perdido}.` +
        (s.aviso ? ` Antes apareció el aviso: “${s.aviso}”.` : ''), ctx);
    } else if (total >= conf.monto || uds >= 10) {
      alerta('media', 'Descartó un pedido grande', e, `Descartó (${motivo}) ${perdido} sin haberlo cobrado.`, ctx);
    } else if (/cerró|recargó|cambió de pantalla/.test(motivo)) {
      alerta(total >= conf.monto / 4 ? 'media' : 'baja', 'Cerró la pantalla con un pedido cargado', e,
        `Cerró, recargó o cambió de pantalla con ${perdido} cargados, sin usar el botón Nuevo.`, ctx);
    } else if (/inactividad/.test(motivo) && total >= conf.monto / 4) {
      alerta('baja', 'Dejó un pedido cargado sin terminar', e,
        `La caja volvió sola al selector y se perdieron ${perdido}.`, ctx);
    }
  }

  function cerrarGuardado(s, e) {
    const total = totalDe(e);
    const ticket = ticketDe(e);
    const modificado = /^✔ MODIFICADO/.test(e.texto);
    const ctx = s.eventos;
    const cod = codigosDe(e);

    // Descartó y a los pocos minutos ingresó lo mismo, pero más barato.
    const previo = descartes.filter((d) => d.e.usuario === e.usuario && e.t - d.e.t >= 0 && e.t - d.e.t <= 15 * 60000 &&
      d.total > total * 1.05 && d.codigos.size).find((d) => {
      let comunes = 0;
      d.codigos.forEach((c) => { if (cod.has(c)) comunes++; });
      return comunes / d.codigos.size >= 0.5;
    });
    if (previo) {
      alerta('alta', 'Descartó y volvió a cargar el pedido más barato', e,
        `A las ${cuando(previo.e)} descartó un pedido de ${fmt(previo.total)} y a las ${cuando(e)} ingresó el ticket ${ticket} ` +
        `con artículos parecidos por ${fmt(total)} (${fmt(previo.total - total)} menos).`, [previo.e].concat(ctx));
    }

    s.precios.forEach((p) => {
      const pct = p.a ? Math.round((p.a - p.b) / p.a * 100) : 100;
      alerta(p.b <= 0 || pct >= 30 ? 'alta' : 'media', 'Bajó el precio de un artículo', p.e,
        `${p.nombre}: de ${fmt(p.a)} a ${fmt(p.b)} (−${pct} %). El pedido se guardó como ticket ${ticket} por ${fmt(total)}.`, ctx);
    });

    if (s.elimTrasCobro.length) {
      alerta('alta', 'Sacó artículos después de elegir el medio de pago', s.elimTrasCobro[0], `Con el cobro ya empezado eliminó ` +
        `${s.elimTrasCobro.length} artículo${s.elimTrasCobro.length === 1 ? '' : 's'} y después guardó el ticket ${ticket} por ${fmt(total)}.`, ctx);
    } else if (s.eliminados.length) {
      const parte = s.elimMonto / ((s.elimMonto + Math.max(total, 0)) || 1);
      if (parte >= 0.3 && s.elimMonto >= conf.monto / 5) {
        alerta('media', 'Sacó muchos artículos antes de cobrar', e,
          `Eliminó ${s.eliminados.length} artículos por ${fmt(s.elimMonto)} (${Math.round(parte * 100)} % de lo cargado) y cobró ${fmt(total)} (ticket ${ticket}).`, ctx);
      }
    }

    s.cantTrasCobro.forEach((c) => {
      alerta('media', 'Bajó cantidades después de elegir el medio de pago', c.e,
        `${c.nombre}: de ${c.a} a ${c.b} unidades con el cobro ya empezado (ticket ${ticket}).`, ctx);
    });

    const desc = plataANum((/Descuento (-?\$ ?[\d.]+)/.exec(e.texto) || [])[1]);
    const pct = desc > 0 && total + desc > 0 ? desc / (total + desc) * 100 : 0;
    if (pct >= conf.descuento) {
      alerta(pct >= conf.descuento * 2 ? 'alta' : 'media', 'Descuento alto', e,
        `Ticket ${ticket}: descuento de ${fmt(desc)} (${Math.round(pct)} %) sobre ${fmt(total + desc)}.`, ctx);
    }

    if (s.noImprimir && /efectivo/i.test(medioDe(e))) {
      alerta('baja', 'Venta en efectivo sin ticket impreso', e,
        `Ticket ${ticket} por ${fmt(total)} en efectivo: eligió no imprimir el comprobante.`, ctx);
    }
    if (s.manual) {
      alerta('baja', 'Cargó artículos sin escanear', e,
        `${s.manual} artículo${s.manual === 1 ? '' : 's'} del ticket ${ticket} se agregaron con la búsqueda manual en vez de la pistola.`, ctx);
    }

    if (modificado) {
      const ant = guardados.get(ticket);
      const totalAnt = ant ? totalDe(ant) : 0;
      const antes = ant ? ` (lo había guardado ${ant.usuario} ${ant.dia !== e.dia ? 'el ' + nombreDia(ant.dia, false) : 'a las ' + cuando(ant)})` : '';
      if (ant && totalAnt > total) {
        alerta('alta', 'Modificó un pedido ya cobrado y bajó el total', e,
          `Ticket ${ticket}: pasó de ${fmt(totalAnt)} a ${fmt(total)} (${fmt(totalAnt - total)} menos)${antes}.`, [ant].concat(ctx));
      } else if (ant && medioDe(ant) !== medioDe(e)) {
        alerta(/efectivo/i.test(medioDe(ant)) ? 'alta' : 'media', 'Cambió el medio de pago de un pedido ya cobrado', e,
          `Ticket ${ticket}: de “${medioDe(ant)}” a “${medioDe(e)}”${antes}.`, [ant].concat(ctx));
      } else {
        alerta('baja', 'Modificó un pedido ya ingresado', e,
          `Ticket ${ticket} por ${fmt(total)}${antes || ' (el original no está en los días analizados)'}.`, ctx);
      }
    }
    if (ticket) guardados.set(ticket, e);
  }

  function revisarHistorial(e) {
    const x = e.texto;
    const ticket = ticketDe(e);
    if (/^✖ CANCELÓ/.test(x)) {
      const ant = guardados.get(ticket);
      const horas = ant ? (e.t - ant.t) / 3600000 : null;
      const crudo = (/Total (.+?) ·/.exec(x) || [])[1] || '';
      const total = plataANum(crudo) || Number(crudo.replace(/[^\d]/g, '')) || (ant ? totalDe(ant) : 0);
      const mismo = ant && ant.usuario === e.usuario;
      alerta(ant && (mismo || horas < 24) ? 'alta' : 'media', 'Canceló un pedido ya cobrado', e,
        `Canceló el ticket ${ticket}${total ? ' por ' + fmt(total) : ''} y el stock volvió al depósito. ` +
        (ant ? `Lo había ingresado ${mismo ? 'la misma persona' : ant.usuario} hace ${horas < 1 ? Math.max(1, Math.round(horas * 60)) + ' min' : Math.round(horas) + ' h'}` +
          ` (${medioDe(ant) || 'medio de pago desconocido'}).` : 'El pedido original no está en los días analizados.'),
        ant ? [ant, e] : [e]);
    } else if (/corrigió el pago parcial/.test(x)) {
      alerta('media', 'Corrigió el pago de un pedido ya guardado', e,
        `Cambió cómo se repartió el pago del pedido ${ticket}. Si pasó plata de efectivo a otro medio, conviene revisarlo.`);
    } else if (/^Reimprimió el ticket/.test(x) && !guardados.has(ticket)) {
      alerta('baja', 'Reimprimió un ticket viejo', e,
        `Reimprimió el ticket ${ticket}, que no se cobró en los días analizados. Un ticket reimpreso puede usarse para retirar mercadería otra vez.`);
    } else if (/contraseña incorrecta/i.test(x)) {
      contrasenaMal(e);
    }
  }

  for (const e of evs) {
    const x = e.texto;
    // Al arrancar el programa no queda ningún pedido en pantalla (de ese equipo).
    if (e.cat === 'SISTEMA' && /arrancó/.test(x)) {
      const pre = (e.eq || '') + '|';
      for (const clave of [...sesiones.keys()]) if (clave.startsWith(pre)) sesiones.delete(clave);
      continue;
    }
    if (e.cat === 'HISTORIAL') { revisarHistorial(e); continue; }
    if (/contraseña .*incorrecta/i.test(x)) { contrasenaMal(e); continue; }
    if (e.cat === 'USUARIO' && /entró igual/.test(x)) {
      alerta('baja', 'Entró con un usuario abierto en otro equipo', e,
        'Usó “Entrar igual”: el usuario estaba conectado en otra caja y lo desconectó.');
      continue;
    }
    if (!CATS_PEDIDO.has(e.cat)) continue;

    const k = (e.eq || '') + '|' + e.dia + '|' + e.ventana;
    let s = sesiones.get(k);
    // "Nuevo" con la pantalla vacía no anota descarte: el pedido siguiente empieza de cero.
    if (s && s.nuevo && !/^✖ DESCARTADO/.test(x)) { s = null; sesiones.delete(k); }
    if (!s) { s = nueva(); sesiones.set(k, s); }
    s.eventos.push(e);

    let m;
    if (e.cat === 'COBRO' && (m = /^Medio de pago: (.+)$/.exec(x)) && m[1] !== '(vacío)') {
      s.medio = m[1];
      s.cobro = s.cobro || e;
    } else if (e.cat === 'PEDIDO' && /^Presionó Ingresar Orden/.test(x)) {
      s.ingresar = true;
      s.cobro = s.cobro || e;
    } else if (e.cat === 'AVISO' && s.ingresar) {
      s.aviso = x.slice(0, 120);
    } else if (e.cat === 'ARTÍCULO' && /^− Eliminó/.test(x)) {
      s.eliminados.push(e);
      s.elimMonto += Math.abs(plataANum(x.slice(x.lastIndexOf('= ') + 2)));
      if (s.cobro) s.elimTrasCobro.push(e);
    } else if (e.cat === 'ARTÍCULO' && /^\+ /.test(x) && /búsqueda manual/.test(x)) {
      s.manual++;
    } else if (e.cat === 'ARTÍCULO' && (m = /^~ Precio de (.+?): (-?\$ ?[\d.]+) → (-?\$ ?[\d.]+)/.exec(x))) {
      const a = plataANum(m[2]), b = plataANum(m[3]);
      if (b < a) s.precios.push({ e, nombre: m[1], a, b });
    } else if (e.cat === 'ARTÍCULO' && (m = /^~ Cantidad de (.+?): (\d+) → (\d+)/.exec(x))) {
      if (Number(m[3]) < Number(m[2]) && s.cobro) s.cantTrasCobro.push({ e, nombre: m[1], a: Number(m[2]), b: Number(m[3]) });
    } else if (e.cat === 'IMPRESIÓN' && /no imprimir/.test(x)) {
      s.noImprimir = true;
    } else if (e.cat === 'CAMBIOS' && /^\+ Agregó/.test(x) && /DEVOLUCIÓN/.test(x)) {
      if (/pedido original —/.test(x)) {
        alerta('alta', 'Devolución sin pedido original', e,
          'Cargó una devolución sin elegir el pedido original: no hay forma de saber si esa mercadería se vendió.', s.eventos.slice());
      } else {
        alerta('baja', 'Devolución de mercadería', e, 'Cargó una devolución con su pedido original.', s.eventos.slice());
      }
    } else if (e.cat === 'PEDIDO' && /^Presionó Nuevo$/.test(x)) {
      s.nuevo = true;
    }

    if (e.cat === 'PEDIDO' && /^✔ /.test(x)) { cerrarGuardado(s, e); sesiones.delete(k); }
    else if (e.cat === 'PEDIDO' && /^✖ DESCARTADO/.test(x)) { cerrarDescarte(s, e); sesiones.delete(k); }
  }

  // Patrón del día: muchos pedidos descartados por la misma persona.
  descartesDia.forEach((lista, k) => {
    if (lista.length < conf.descartes) return;
    const suma = lista.reduce((a, e) => a + totalDe(e), 0);
    const ultimo = lista[lista.length - 1];
    alerta(lista.length >= conf.descartes * 2 ? 'alta' : 'media', 'Muchos pedidos descartados en el día', ultimo,
      `Descartó ${lista.length} pedidos con artículos en el día, por ${fmt(suma)} en total.`, lista);
  });

  return alertas.sort((a, b) => PESO[b.sev] - PESO[a.sev] || b.t - a.t);
}

return {
  RAPIDOS, PESO, NOMBRE_SEV, CONF_DEFECTO,
  interpretar, analizar, nombreDia, plataANum, fmt, totalDe
};
});
