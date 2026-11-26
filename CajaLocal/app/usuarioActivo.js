// === USUARIO ACTIVO DE LA CAJA ===
// Al entrar (después del login de Firebase) se pregunta quién está usando el
// equipo. El nombre elegido:
//   · es el vendedor de cada pedido nuevo (ingresoPedidoV2.js),
//   · es el nombre con el que este equipo aparece en Mensajes (chat.js),
//   · queda visible en el encabezado (#usuarioActualBtn), que permite cambiarlo.
//
// La lista sale de la planilla (Usuarios!A:B). La columna B dice en qué punto de venta trabaja
// cada uno (puntoVenta.js): "1", "2"… o vacía si trabaja en todos. Se
// muestran sólo los del punto de venta de este equipo. "WhatsApp" no es una persona sino un modo, así
// que no aparece como botón.
//
// Se recuerda por pestaña (sessionStorage): después de guardar un pedido la
// página se recarga y no tiene sentido volver a preguntar. Una pestaña o
// ventana nueva sí vuelve a preguntar.
//
// Un usuario no puede estar en dos equipos a la vez: el selector lee la
// presencia que publica chat.js (chat/presencia) y marca como "Conectado" a
// quien ya está en otra caja. Abrir el selector desconecta al usuario de esta
// pestaña (queda libre para otro equipo) y no se cierra sin elegir a alguien.
//
// Si una caja se cerró de golpe (corte de luz, PC apagada, internet caído),
// Firebase puede tardar unos minutos en darla por desconectada. Para no
// quedar trabado, tocar a alguien "Conectado" ofrece "Entrar igual", que pide
// confirmación: esa conexión se descarta y, si el otro equipo en verdad
// seguía abierto, chat.js lo devuelve a este selector con un aviso.
//
// "WhatsApp" no es una persona sino un modo con contraseña. La pide este
// archivo (no la página), así funciona igual en la caja y en el historial; la
// marca 'hpModoWhatsapp' de sessionStorage la lee ingresoPedidoV2.js para
// prender la búsqueda manual y el vendedor WhatsApp.
//
// Tras 4 minutos sin uso se vuelve a este selector (ver "inactividad"). En
// la caja sólo si el pedido no tiene artículos; en el historial siempre.
// Excepción: "Puesto fijo", al pie del selector, deja a ese usuario en este
// equipo sin límite de tiempo (localStorage 'hpPuestoFijo' = su nombre).
//
// Clave personal: cada persona puede tener una clave de 4 dígitos (nodo
// usuariosClaves de Firebase, guardada como hash con sal, nunca el número).
// Quien la tiene la escribe al elegir su nombre; quien todavía no la creó
// entra como siempre y se le invita a crearla (una vez por día y equipo).
// "Clave personal", al pie, la crea o la cambia. La clave maestra del
// encargado (en el código sólo va su hash) permite poner una nueva o
// quitarla cuando alguien se la olvida. WhatsApp, Offline y los usuarios
// genéricos ("Otro") no llevan.
//
// Se carga en <head>, antes del script de login: el resto del archivo sólo
// toca el DOM cuando hace falta.
(function() {
  'use strict';

  const RANGO = 'Usuarios!A:B';
  const SS_ACTUAL = 'hpUsuarioActivo';
  const LS_ULTIMO = 'hpUsuarioUltimo';
  // Usuario con puesto fijo en este equipo: no vuelve al selector por inactividad.
  const LS_PUESTO_FIJO = 'hpPuestoFijo';
  // La caché es por punto de venta: cada uno tiene su propia lista.
  const PUNTO_VENTA = window.PuntoVenta ? PuntoVenta.actual() : null;
  const LS_CACHE = 'hpVendedoresCache' + (PUNTO_VENTA && PUNTO_VENTA !== '1' ? '_' + PUNTO_VENTA : '');
  const EVENTO = 'usuarioactivo:cambio';
  const NO_PERSONAS = ['whatsapp'];
  const RUTA_PRESENCIA = 'chat/presencia';
  // Al pasar de una pantalla a otra la pestaña suelta su conexión y la vuelve
  // a anotar al cargar: durante ese instante el usuario no cuenta como libre.
  const GRACIA_NAVEGACION_MS = 8 * 1000;
  // Modo WhatsApp de esta pestaña (lo lee ingresoPedidoV2.js) y su contraseña.
  const SS_MODO_WHATSAPP = 'hpModoWhatsapp';
  const CLAVE_WHATSAPP = '2381';
  // Clave personal (ver "clave personal" más abajo). Las claves son por
  // punto de venta, como la lista de vendedores: cada uno tiene su Firebase.
  const RUTA_CLAVES = 'usuariosClaves';
  const SUFIJO_PV = PUNTO_VENTA && PUNTO_VENTA !== '1' ? '_' + PUNTO_VENTA : '';
  const LS_CLAVES = 'hpClavesCache' + SUFIJO_PV;
  const LS_INVITACION = 'hpClaveInvitacion' + SUFIJO_PV;
  // Ícono que eligió cada persona ("Cambiar ícono", al pie del selector).
  // Nodo usuariosIconos/{claveDe(nombre)} = "gato": unos pocos bytes por
  // persona. Se lee una sola vez por página y queda en localStorage.
  const RUTA_ICONOS = 'usuariosIconos';
  const LS_ICONOS = 'hpIconosCache' + SUFIJO_PV;
  const LARGO_CLAVE = 4;
  const LARGO_MAESTRA = 8;
  // SHA-256 de 'hp-maestra:' + la clave maestra. El código de la web es
  // público: la clave en sí no puede estar escrita acá.
  const HASH_MAESTRA = '48a082f649d5ec6a5192cb69c24fb3fc5eec88d0ad6ae7687fa7748cacdbb077';
  const MAX_INTENTOS = 5;
  const ESPERA_INTENTOS_MS = 30 * 1000;

  // Identidad de cada vendedor: un animal, y cada animal tiene su color fijo
  // (el de la misma posición en TONOS). Nunca hay dos personas con el mismo
  // animal (ni, por lo tanto, el mismo color). Cada persona elige el suyo con
  // "Cambiar ícono" entre los que están libres y lo lleva siempre. Quien
  // todavía no eligió recibe uno libre (ver asignacion()): puede cambiar si
  // entra gente nueva a la planilla, hasta que elija el propio.
  // Colores apagados, pensados para leerse sobre grafito y sobre blanco.
  // Uno por animal, en el mismo orden que ANIMALES: los 6 últimos se eligieron
  // lejos de los 12 primeros (mostaza, pizarra, bordó, marino, lima, naranja)
  // para que no haya dos círculos que se confundan.
  const TONOS = [
    '#7c5fd0', '#3f8fe6', '#1f9d86', '#d08a1e', '#d6604f', '#b25cc4',
    '#2fa3c7', '#7d9446', '#d1517f', '#4f5fd1', '#3fa35a', '#a86b3c',
    '#c4a31d', '#607489', '#9a2d42', '#26457d', '#94b02a', '#ea6c1f'
  ];

  // Íconos de línea en 24×24, trazo blanco. Caras de frente para que todos
  // se lean igual de grandes dentro del círculo.
  const ANIMALES = {
    gato:     '<path d="M4.5 4.5 8 7.6A7 7 0 0 1 16 7.6l3.5-3.1V12a7.5 7.5 0 0 1-15 0Z"/><path d="M9.5 12h.01M14.5 12h.01"/><path d="M10.8 15h2.4L12 16.3Z"/>',
    perro:    '<path d="M7 7.5c1-2 2.8-3 5-3s4 1 5 3V14a5 5 0 0 1-10 0Z"/><path d="M7 8C5 6 3 7 3 9.5S4.5 14 6.5 13.5M17 8c2-2 4-1 4 1.5S19.5 14 17.5 13.5"/><path d="M10 10.5h.01M14 10.5h.01"/><path d="M11 14h2l-1 1.2Z"/>',
    zorro:    '<path d="M4 4l4 3.5h8L20 4l-1 8-7 8-7-8Z"/><path d="M9.5 11.5h.01M14.5 11.5h.01M12 16h.01"/>',
    oso:      '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><circle cx="12" cy="13" r="7"/><ellipse cx="12" cy="15.5" rx="2.6" ry="2"/><path d="M9.5 11h.01M14.5 11h.01M12 15h.01"/>',
    conejo:   '<ellipse cx="9.5" cy="5.5" rx="1.6" ry="4"/><ellipse cx="14.5" cy="5.5" rx="1.6" ry="4"/><circle cx="12" cy="15" r="6"/><path d="M10 14.5h.01M14 14.5h.01M12 17h.01"/>',
    buho:     '<path d="M5 5l2.5 2.2A6.5 6.5 0 0 1 16.5 7.2L19 5v9a7 7 0 0 1-14 0Z"/><circle cx="9.3" cy="12" r="2"/><circle cx="14.7" cy="12" r="2"/><path d="M11.2 15.2h1.6L12 16.5Z"/>',
    pinguino: '<path d="M12 3c-3.5 0-5.5 3-5.5 8v4c0 3.3 2.5 6 5.5 6s5.5-2.7 5.5-6v-4c0-5-2-8-5.5-8Z"/><path d="M6.5 12 4 15M17.5 12l2.5 3"/><path d="M10 7.5h.01M14 7.5h.01"/><path d="M11 9.6h2L12 10.9Z"/>',
    raton:    '<circle cx="6.5" cy="7.5" r="3.5"/><circle cx="17.5" cy="7.5" r="3.5"/><circle cx="12" cy="14" r="6"/><path d="M10 13.5h.01M14 13.5h.01M12 16.5h.01"/>',
    cerdo:    '<circle cx="12" cy="12.5" r="7.5"/><path d="M6.4 7.4 5.2 3.6l4 2.2M17.6 7.4l1.2-3.8-4 2.2"/><ellipse cx="12" cy="14.6" rx="3" ry="2.2"/><path d="M11 14.6h.01M13 14.6h.01M9 10.5h.01M15 10.5h.01"/>',
    rana:     '<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><path d="M4 13c0-3 2-5 4-5.5h8c2 .5 4 2.5 4 5.5 0 4-3.6 6.5-8 6.5S4 17 4 13Z"/><path d="M8.5 14.5c2 1.5 5 1.5 7 0M8 7h.01M16 7h.01"/>',
    pez:      '<path d="M3 12c3-5 9-6.5 13-3l4-3v12l-4-3c-4 3.5-10 2-13-3Z"/><path d="M8 11h.01"/><path d="M11 9.5c.8 1.6.8 3.4 0 5"/>',
    tortuga:  '<path d="M3 15a8 7 0 0 1 16 0Z"/><path d="M7.5 15l1.5-4h4l1.5 4M9 11l2-3 2 3"/><path d="M6 15v2.5M16 15v2.5"/><path d="M19 13.5c.5-1.6 2.5-1.9 3-.3s-.6 2.3-2 2.3"/>',
    leon:     '<circle cx="12" cy="12" r="9" stroke-dasharray="2.4 1.7"/><circle cx="12" cy="12.5" r="5.5"/><path d="M10 11.5h.01M14 11.5h.01"/><path d="M11 14h2l-1 1.1Z"/>',
    mono:     '<circle cx="4.8" cy="12" r="2.3"/><circle cx="19.2" cy="12" r="2.3"/><circle cx="12" cy="12" r="6.5"/><path d="M8.6 13.2c0-1.8 1.5-2.6 3.4-2.6s3.4.8 3.4 2.6c0 2-1.5 3.3-3.4 3.3s-3.4-1.3-3.4-3.3Z"/><path d="M10 9.4h.01M14 9.4h.01"/><path d="M10.9 14.6c.7.4 1.5.4 2.2 0"/>',
    koala:    '<circle cx="5.5" cy="8.5" r="3.2"/><circle cx="18.5" cy="8.5" r="3.2"/><circle cx="12" cy="13" r="6.5"/><ellipse cx="12" cy="14.2" rx="1.7" ry="2.4"/><path d="M9.2 11.5h.01M14.8 11.5h.01"/>',
    panda:    '<circle cx="6.3" cy="6.8" r="2.1"/><circle cx="17.7" cy="6.8" r="2.1"/><circle cx="12" cy="13" r="7"/><ellipse cx="9" cy="12.4" rx="1.6" ry="2.3" transform="rotate(28 9 12.4)"/><ellipse cx="15" cy="12.4" rx="1.6" ry="2.3" transform="rotate(-28 15 12.4)"/><path d="M11.2 16h1.6L12 16.9Z"/>',
    vaca:     '<path d="M7 7l-2.5-3M17 7l2.5-3"/><path d="M6 9 3 9.8l3 1.4M18 9l3 .8-3 1.4"/><path d="M7.5 6.5h9a1.5 1.5 0 0 1 1.5 1.5V13H6V8a1.5 1.5 0 0 1 1.5-1.5Z"/><rect x="6.5" y="13" width="11" height="6.5" rx="3.2"/><path d="M9.5 10h.01M14.5 10h.01M10 16.3h.01M14 16.3h.01"/>',
    pato:     '<circle cx="10.5" cy="10" r="6"/><path d="M15.6 11.2H20a1.6 1.6 0 0 1 0 3.2h-4.8"/><path d="M11.5 8.5h.01"/><path d="M6 17.5c1.8 2 6.8 2.6 9 0"/>'
  };
  const ORDEN_ANIMALES = Object.keys(ANIMALES);

  function svgAnimal(clave) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ANIMALES[clave] + '</svg>';
  }

  // Sin acentos ni mayúsculas: en la planilla vale "Búho", "buho" o "BUHO".
  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  }

  // El animal si es uno de la lista, o null.
  function animalValido(texto) {
    const a = normalizar(texto);
    return ANIMALES[a] ? a : null;
  }

  const NOMBRE_ANIMAL = {
    gato: 'Gato', perro: 'Perro', zorro: 'Zorro', oso: 'Oso', conejo: 'Conejo', buho: 'Búho',
    pinguino: 'Pingüino', raton: 'Ratón', cerdo: 'Cerdo', rana: 'Rana', pez: 'Pez', tortuga: 'Tortuga',
    leon: 'León', mono: 'Mono', koala: 'Koala', panda: 'Panda', vaca: 'Vaca', pato: 'Pato'
  };

  // { claveDe(nombre): animal }, de Firebase (o de la caché mientras tanto).
  function limpiarIconos(v) {
    const r = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.keys(v).forEach(k => { const a = animalValido(v[k]); if (a) r[k] = a; });
    }
    return r;
  }
  let iconosElegidos = (() => {
    try { return limpiarIconos(JSON.parse(lsGet(LS_ICONOS) || '{}')); } catch (_) { return {}; }
  })();

  // Animal que sale del nombre mientras la persona no eligió uno.
  function animalPorNombre(nombre) {
    const s = normalizar(nombre);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ORDEN_ANIMALES[(h >>> 0) % ORDEN_ANIMALES.length];
  }

  // La lista vigente de personas (la última que respondió la planilla, o la
  // de la caché mientras tanto): la usa el selector para pintar los botones.
  let listaIdentidades = [];

  // "WhatsApp" no es una persona de la planilla sino el modo homónimo: va
  // siempre al final de la grilla, con su verde y su globo de chat.
  const WHATSAPP = 'WhatsApp';
  const TONO_WHATSAPP = '#25d366';
  const ICONO_WHATSAPP = '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1Z"/><path d="M9 8.6c0 3.4 2.9 6.4 6.4 6.4l1-1.5-2-1-1 .9a5 5 0 0 1-2.7-2.7l.9-1-1-2Z"/>';

  function esWhatsapp(nombre) { return nombre.toLowerCase() === WHATSAPP.toLowerCase(); }

  // "Offline" tampoco es una persona: es el modo de emergencia sin internet
  // (modoOffline.js). Solo existe en la caja de escritorio, y el botón
  // aparece solo cuando no hay conexión.
  const TONO_OFFLINE = '#5f6470';
  const ICONO_OFFLINE = '<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7"/><path d="M19 12.9a10 10 0 0 0-2-1.5"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8a15 15 0 0 0-11.3-3.8"/><path d="m2 2 20 20"/>';

  function modoOffline() { return window.ModoOffline || null; }
  function esOffline(nombre) { const m = modoOffline(); return !!m && m.esOffline(nombre); }

  function svgAvatar(id) {
    if (id.whatsapp || id.offline) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (id.offline ? ICONO_OFFLINE : ICONO_WHATSAPP) + '</svg>';
    }
    return svgAnimal(id.animal);
  }

  function identidad(nombre) {
    if (esWhatsapp(nombre)) return { tono: TONO_WHATSAPP, whatsapp: true };
    if (esOffline(nombre)) return { tono: TONO_OFFLINE, offline: true };
    const k = claveDe(nombre);
    const animal = asignacion()[k] || iconosElegidos[k] || animalPorNombre(nombre);
    return { tono: TONOS[ORDEN_ANIMALES.indexOf(animal)], animal };
  }

  // Quién lleva cada animal, sin repetir ninguno:
  //   1. lo elegido con "Cambiar ícono" reserva su animal (si dos eligieron el
  //      mismo a la vez, lo conserva el primero de la planilla);
  //   2. el resto recibe, en orden de planilla, el primer animal libre a partir
  //      del que le sale por su nombre.
  // Se recalcula sólo si cambia la lista o lo elegido.
  let cacheAsignacion = null;
  function asignacion() {
    const firma = listaIdentidades.join('|') + '#' + JSON.stringify(iconosElegidos);
    if (cacheAsignacion && cacheAsignacion.firma === firma) return cacheAsignacion.mapa;
    const mapa = {};
    const usados = new Set();
    const claves = listaIdentidades.filter(esPersonaIcono).map(claveDe);
    claves.forEach(k => {
      const a = iconosElegidos[k];
      if (a && !usados.has(a)) { mapa[k] = a; usados.add(a); }
    });
    // Gente de otro local de la misma base que ya eligió: también reserva.
    Object.keys(iconosElegidos).forEach(k => {
      if (!claves.includes(k) && iconosElegidos[k]) usados.add(iconosElegidos[k]);
    });
    listaIdentidades.filter(esPersonaIcono).forEach(n => {
      const k = claveDe(n);
      if (mapa[k]) return;
      const inicio = ORDEN_ANIMALES.indexOf(animalPorNombre(n));
      for (let i = 0; i < ORDEN_ANIMALES.length; i++) {
        const a = ORDEN_ANIMALES[(inicio + i) % ORDEN_ANIMALES.length];
        if (!usados.has(a)) { mapa[k] = a; usados.add(a); return; }
      }
      mapa[k] = animalPorNombre(n);   // más personas que animales
    });
    cacheAsignacion = { firma, mapa };
    return mapa;
  }
  function esPersonaIcono(n) { return !esWhatsapp(n) && !esOffline(n); }

  let actual = ssGet(SS_ACTUAL) || '';
  let promesaVendedores = null;

  // ------------------------------------------------------------- helpers --
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (_) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  // Registro diario de la caja de escritorio (registroCaja.js). En la web no hace nada.
  function reg(texto) { if (window.Registro) window.Registro.anotar('USUARIO', texto); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function cuandoListo(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function reduceMovimiento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------------------------------------------------------- vendedores --
  // Una sola consulta a la planilla por carga de página; la comparten el
  // selector y el desplegable de Vendedor. Resuelve [] si la planilla no
  // responde: cada consumidor decide su respaldo.
  function cargarVendedores() {
    if (promesaVendedores) return promesaVendedores;
    if (typeof GOOGLE_SHEETS_CONFIG === 'undefined') {
      promesaVendedores = Promise.resolve([]);
      return promesaVendedores;
    }
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(RANGO)}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
    promesaVendedores = fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(data => {
        const vistos = new Set();
        const nombres = [];
        (data.values || []).forEach((fila, i) => {
          const nombre = (fila && fila[0] ? String(fila[0]) : '').trim();
          if (!nombre) return;
          // El rango arranca en A1: si esa celda es el rótulo de la columna, no es un vendedor.
          if (i === 0 && ['vendedor', 'vendedores', 'usuario', 'usuarios', 'nombre'].includes(nombre.toLowerCase())) return;
          if (!trabajaEnEstePunto(fila[1])) return;
          const clave = nombre.toLowerCase();
          if (vistos.has(clave)) return;
          vistos.add(clave);
          nombres.push(nombre);
        });
        if (nombres.length) lsSet(LS_CACHE, JSON.stringify(nombres));
        return nombres;
      })
      .catch(err => {
        console.warn('No se pudo cargar la lista de vendedores desde Google Sheets:', err);
        return [];
      });
    return promesaVendedores;
  }

  // Columna B vacía = trabaja en todos los puntos de venta. Admite varios
  // separados por coma ("1, 2"). Sin punto de venta definido no se filtra.
  function trabajaEnEstePunto(celda) {
    const valor = (celda == null ? '' : String(celda)).trim();
    if (!valor || !PUNTO_VENTA) return true;
    return valor.split(/[\s,;\/]+/).filter(Boolean).includes(PUNTO_VENTA);
  }

  function soloPersonas(nombres) {
    return nombres.filter(n => !NO_PERSONAS.includes(n.toLowerCase()));
  }

  // Lo último que respondió la planilla, para pintar los botones al instante.
  function cacheVendedores() {
    try {
      const v = JSON.parse(lsGet(LS_CACHE) || '[]');
      return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];
    } catch (_) { return []; }
  }

  // Último recurso sin planilla ni caché. Antes salía de las <option> del
  // desplegable Vendedor de la caja, que ya no existe: sin esta lista, un
  // equipo que nunca cargó la planilla no podría elegir usuario.
  // Copia de Usuarios!A:B: [nombre, punto de venta] con el mismo criterio que
  // la columna B (vacío = trabaja en todos). "WhatsApp" no sale como botón:
  // soloPersonas() lo descarta.
  const RESPALDO_VENDEDORES = [
    ['Elias', '1'], ['Valentin', '1'], ['Horacio', '1'], ['Sabrina', '1'],
    ['Leonardo', '1'], ['Alejandro', '1'],
    ['Juan', '2'], ['Matias', '2'], ['Maria', '2'], ['Jorge', '2'],
    ['Javier', ''], ['Otro', ''],
    ['WhatsApp', '1']
  ];
  function respaldoHtml() {
    return RESPALDO_VENDEDORES
      .filter(([, punto]) => trabajaEnEstePunto(punto))
      .map(([nombre]) => nombre);
  }

  // ------------------------------------------------------------- markup --
  let overlay, grilla, estadoEl, headerBtn;
  let abierto = false;
  // Mensaje que queda fijo en el selector mientras está abierto (por ejemplo,
  // "tu usuario se abrió en otro equipo"); se borra al elegir a alguien.
  let aviso = '';

  function limpiarEstado() { estadoEl.textContent = aviso; }
  let ultimaTeclaImprimible = 0;

  function construir() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'usuarioOverlay';
    overlay.className = 'usr-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'usrTitulo');
    overlay.setAttribute('aria-describedby', 'usrSub');
    overlay.innerHTML = `
      <div class="usr-panel">
        <header class="usr-head">
          <span class="usr-eyebrow"><span class="usr-eyebrow-punto" aria-hidden="true"></span><span id="usrFecha"></span></span>
          <h1 id="usrTitulo" class="usr-titulo">Selecciona Usuario</h1>
          <p id="usrSub" class="usr-sub">Toca tu nombre para continuar</p>
        </header>
        <div id="usrGrilla" class="usr-grilla" role="listbox" aria-labelledby="usrTitulo"></div>
        <div id="usrEstado" class="usr-estado" role="status" aria-live="polite"></div>
        <footer class="usr-pie">
          <span class="usr-pie-tecla" aria-hidden="true">←</span><span class="usr-pie-tecla" aria-hidden="true">→</span>
          para moverte ·
          <span class="usr-pie-tecla" aria-hidden="true">Enter</span>
          para elegir · Podés cambiar de usuario desde el encabezado
        </footer>
        <button type="button" class="usr-fijo" aria-pressed="false"
                title="Para quien trabaja siempre en este equipo. Con esto prendido, la caja no vuelve sola a esta pantalla aunque pase el tiempo.">
          <span class="usr-fijo-switch" aria-hidden="true"></span>
          Puesto fijo · no volver a esta pantalla por inactividad
        </button>
        <button type="button" class="usr-clave-pie" aria-pressed="false"
                title="Crear o cambiar tu clave de 4 dígitos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>
          <span class="usr-clave-pie-texto">Clave personal</span>
        </button>
        <button type="button" class="usr-clave-pie usr-icono-pie" aria-pressed="false"
                title="Elegir el animal que te representa">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/></svg>
          <span class="usr-icono-pie-texto">Cambiar ícono</span>
        </button>
        <div class="usr-pv" hidden>
          <span class="usr-pv-nombre"></span>
          <span aria-hidden="true">·</span>
          <button type="button" class="usr-pv-cambiar">Cambiar punto de venta</button>
        </div>
      </div>
      <span class="usr-version" aria-hidden="true"></span>`;
    document.body.appendChild(overlay);

    // Versión de la aplicación, discreta en la esquina. En la caja de
    // escritorio la da la app (preload.js: cajaApp.version); en la web no hay
    // número de versión, sólo se indica que es la web.
    const app = window.cajaApp;
    overlay.querySelector('.usr-version').textContent =
      app && app.escritorio
        ? 'Caja local' + (app.version ? ' · v' + app.version : '') +
          // Nombre del equipo (o el de Windows si todavía no tiene): el mismo
          // con el que aparece en el panel "Actividad de las cajas".
          (app.equipo && (app.equipo.nombre || app.equipo.host) ? ' · ' + (app.equipo.nombre || app.equipo.host) : '')
        : 'Versión web';

    // Función oculta: 5 clics seguidos en la versión abren el visor del
    // registro diario (sólo en la caja de escritorio, sólo para mirar).
    // "Seguidos": entre un clic y el siguiente no puede pasar más de 0,6 s.
    if (app && app.registro && app.registro.abrirVisor) {
      const versionEl = overlay.querySelector('.usr-version');
      versionEl.classList.add('usr-version-clic');
      let clics = 0, ultimoClic = 0;
      versionEl.addEventListener('click', () => {
        const ahora = Date.now();
        clics = ahora - ultimoClic <= 600 ? clics + 1 : 1;
        ultimoClic = ahora;
        if (clics < 5) return;
        clics = 0;
        reg('Abrió el visor del registro');
        app.registro.abrirVisor();
      });
    }

    grilla = overlay.querySelector('#usrGrilla');
    estadoEl = overlay.querySelector('#usrEstado');
    construirClave();
    // Punto de venta del equipo (puntoVenta.js): discreto, al pie. Cambiarlo
    // pide su contraseña y recarga la página en el otro proyecto.
    const pv = overlay.querySelector('.usr-pv');
    if (window.PuntoVenta && PuntoVenta.multiple()) {
      pv.querySelector('.usr-pv-nombre').textContent = PuntoVenta.nombre();
      const btn = pv.querySelector('.usr-pv-cambiar');
      btn.addEventListener('click', () => PuntoVenta.pedirCambio(() => btn.focus({ preventScroll: true })));
      pv.hidden = false;
    }
    fijoBtn = overlay.querySelector('.usr-fijo');
    fijoBtn.addEventListener('click', () => {
      fijoTocado = true;
      pintarFijo(fijoBtn.getAttribute('aria-pressed') !== 'true');
    });
    clavePieBtn = overlay.querySelector('.usr-clave-pie');
    clavePieBtn.addEventListener('click', () => modoClave(!enModoClave));
    iconoPieBtn = overlay.querySelector('.usr-icono-pie');
    iconoPieBtn.addEventListener('click', () => modoIcono(!enModoIcono));
    tituloEl = overlay.querySelector('#usrTitulo');
    subEl = overlay.querySelector('#usrSub');
    grilla.addEventListener('click', e => {
      const b = e.target.closest('.usr-tile');
      if (!b) return;
      if (enModoClave) gestionarClave(b.dataset.nombre, b);
      else if (enModoIcono) gestionarIcono(b.dataset.nombre, b);
      else elegir(b.dataset.nombre, b);
    });
    overlay.addEventListener('keydown', teclado, true);
  }

  // --------------------------------------------------- clave WhatsApp --
  // Va fuera del overlay: el teclado del selector descarta las teclas
  // imprimibles (por la pistola) y acá hay que poder escribir.
  let claveEl, claveInput, claveError, alResolverClave = null;

  function construirClave() {
    claveEl = document.createElement('div');
    claveEl.id = 'usrClave';
    claveEl.className = 'usr-clave';
    claveEl.hidden = true;
    claveEl.setAttribute('role', 'dialog');
    claveEl.setAttribute('aria-modal', 'true');
    claveEl.setAttribute('aria-labelledby', 'usrClaveTitulo');
    claveEl.innerHTML = `
      <form class="usr-clave-card" novalidate>
        <span class="usr-avatar usr-clave-avatar" aria-hidden="true"></span>
        <h2 id="usrClaveTitulo" class="usr-clave-titulo"></h2>
        <p class="usr-clave-sub"></p>
        <input type="password" class="usr-clave-input" autocomplete="off" aria-label="Contraseña" aria-describedby="usrClaveError">
        <div id="usrClaveError" class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
          <button type="submit" class="usr-clave-btn usr-clave-ok">Entrar</button>
        </div>
      </form>`;
    document.body.appendChild(claveEl);
    claveInput = claveEl.querySelector('.usr-clave-input');
    claveError = claveEl.querySelector('.usr-clave-error');
    const card = claveEl.querySelector('.usr-clave-card');
    card.addEventListener('submit', e => {
      e.preventDefault();
      if (claveValida(claveInput.value)) { resolverClave(true); return; }
      claveError.textContent = 'Contraseña incorrecta';
      reg('Contraseña de WhatsApp incorrecta');
      claveInput.value = '';
      claveInput.focus();
      // Sacudida corta: el error se siente sin tener que leerlo.
      card.classList.remove('usr-clave-mal');
      void card.offsetWidth;
      card.classList.add('usr-clave-mal');
    });
    claveEl.querySelector('.usr-clave-cancelar').addEventListener('click', () => resolverClave(false));
    claveEl.addEventListener('click', e => { if (e.target === claveEl) resolverClave(false); });
    claveEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolverClave(false); }
    });
  }

  const CLAVES = {
    whatsapp: {
      id: { whatsapp: true, tono: TONO_WHATSAPP },
      titulo: 'Modo WhatsApp',
      sub: 'Ingresá la contraseña para atender los pedidos de WhatsApp.',
      valida: v => v === CLAVE_WHATSAPP
    }
  };
  let claveValida = CLAVES.whatsapp.valida;

  function pedirClave(cb, tipo) {
    const conf = CLAVES[tipo] || CLAVES.whatsapp;
    claveValida = conf.valida;
    const av = claveEl.querySelector('.usr-clave-avatar');
    av.style.setProperty('--tono', conf.id.tono);
    av.innerHTML = svgAvatar(conf.id);
    claveEl.querySelector('.usr-clave-titulo').textContent = conf.titulo;
    claveEl.querySelector('.usr-clave-sub').textContent = conf.sub;
    alResolverClave = cb;
    claveInput.value = '';
    claveError.textContent = '';
    claveEl.querySelector('.usr-clave-card').classList.remove('usr-clave-mal');
    claveEl.hidden = false;
    setTimeout(() => claveInput.focus(), 60);
  }

  function resolverClave(ok) {
    if (claveEl.hidden) return;
    claveEl.hidden = true;
    const cb = alResolverClave;
    alResolverClave = null;
    if (cb) cb(ok);
  }

  // ------------------------------------------------ aviso modo Offline --
  // Misma tarjeta que la contraseña. No pide una clave: hay que marcar que se
  // entendió y escribir "homepoint", para que el aviso se lea antes de entrar.
  let avisoOffEl, alResolverAvisoOff = null;

  function construirAvisoOffline() {
    const m = modoOffline();
    avisoOffEl = document.createElement('div');
    avisoOffEl.id = 'usrAvisoOffline';
    avisoOffEl.className = 'usr-clave';
    avisoOffEl.hidden = true;
    avisoOffEl.setAttribute('role', 'alertdialog');
    avisoOffEl.setAttribute('aria-modal', 'true');
    avisoOffEl.setAttribute('aria-labelledby', 'usrAvisoOffTitulo');
    avisoOffEl.setAttribute('aria-describedby', 'usrAvisoOffSub');
    avisoOffEl.innerHTML = `
      <form class="usr-clave-card usr-aviso-off" novalidate>
        <span class="usr-avatar usr-clave-avatar" style="--tono:${TONO_OFFLINE}" aria-hidden="true">${svgAvatar({ offline: true })}</span>
        <h2 id="usrAvisoOffTitulo" class="usr-clave-titulo">Modo Offline</h2>
        <div id="usrAvisoOffSub" class="usr-aviso-off-texto">
          <p class="usr-aviso-off-alerta"><strong>Solo un equipo a la vez</strong> puede cargar pedidos en este modo.</p>
          <p>Si otra caja ya está en modo Offline, no entres desde esta.</p>
        </div>
        <label class="usr-aviso-off-check">
          <input type="checkbox">
          <span>Entendido: solo este equipo va a cargar pedidos</span>
        </label>
        <label class="usr-aviso-off-label" for="usrAvisoOffInput">Escribí <strong>${esc(m.PALABRA_CONFIRMAR)}</strong> para continuar</label>
        <input type="text" id="usrAvisoOffInput" class="usr-clave-input usr-aviso-off-input" autocomplete="off" spellcheck="false" placeholder="${esc(m.PALABRA_CONFIRMAR)}" aria-describedby="usrAvisoOffNota">
        <p id="usrAvisoOffNota" class="usr-aviso-off-nota">No es una contraseña: es solo para confirmar que leíste el aviso.</p>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
          <button type="submit" class="usr-clave-btn usr-aviso-off-ok" disabled>Entrar</button>
        </div>
      </form>`;
    document.body.appendChild(avisoOffEl);
    const card = avisoOffEl.querySelector('form');
    const check = card.querySelector('input[type="checkbox"]');
    const input = card.querySelector('.usr-aviso-off-input');
    const ok = card.querySelector('.usr-aviso-off-ok');
    // "Entrar" se habilita recién con el check marcado y la palabra escrita.
    const listo = () => check.checked && modoOffline().palabraCorrecta(input.value);
    const actualizar = () => { ok.disabled = !listo(); };
    check.addEventListener('change', actualizar);
    input.addEventListener('input', actualizar);
    card.addEventListener('submit', e => {
      e.preventDefault();
      if (listo()) resolverAvisoOffline(true);
    });
    card.querySelector('.usr-clave-cancelar').addEventListener('click', () => resolverAvisoOffline(false));
    avisoOffEl.addEventListener('click', e => { if (e.target === avisoOffEl) resolverAvisoOffline(false); });
    avisoOffEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolverAvisoOffline(false); }
    });
  }

  function pedirAvisoOffline(cb) {
    if (!avisoOffEl) construirAvisoOffline();
    alResolverAvisoOff = cb;
    const check = avisoOffEl.querySelector('input[type="checkbox"]');
    const input = avisoOffEl.querySelector('.usr-aviso-off-input');
    check.checked = false;
    input.value = '';
    avisoOffEl.querySelector('.usr-aviso-off-ok').disabled = true;
    avisoOffEl.hidden = false;
    setTimeout(() => check.focus(), 60);
  }

  function resolverAvisoOffline(ok) {
    if (!avisoOffEl || avisoOffEl.hidden) return;
    avisoOffEl.hidden = true;
    const cb = alResolverAvisoOff;
    alResolverAvisoOff = null;
    if (cb) cb(ok);
  }

  function modoWhatsappActivo() { return ssGet(SS_MODO_WHATSAPP) === '1'; }

  // ------------------------------------------- confirmar "Entrar igual" --
  // Misma tarjeta que la contraseña: entrar igual cierra la sesión del otro
  // equipo, así que se explica antes de hacerlo.
  let confirmarEl, alResolverConfirmar = null;

  function construirConfirmar() {
    confirmarEl = document.createElement('div');
    confirmarEl.id = 'usrConfirmar';
    confirmarEl.className = 'usr-clave';
    confirmarEl.hidden = true;
    confirmarEl.setAttribute('role', 'alertdialog');
    confirmarEl.setAttribute('aria-modal', 'true');
    confirmarEl.setAttribute('aria-labelledby', 'usrConfirmarTitulo');
    confirmarEl.setAttribute('aria-describedby', 'usrConfirmarSub');
    confirmarEl.innerHTML = `
      <div class="usr-clave-card">
        <span class="usr-avatar usr-clave-avatar" aria-hidden="true"></span>
        <h2 id="usrConfirmarTitulo" class="usr-clave-titulo"></h2>
        <p id="usrConfirmarSub" class="usr-clave-sub usr-confirmar-sub"></p>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
          <button type="button" class="usr-clave-btn usr-confirmar-ok">Entrar igual</button>
        </div>
      </div>`;
    document.body.appendChild(confirmarEl);
    confirmarEl.querySelector('.usr-clave-cancelar').addEventListener('click', () => resolverConfirmar(false));
    confirmarEl.querySelector('.usr-confirmar-ok').addEventListener('click', () => resolverConfirmar(true));
    confirmarEl.addEventListener('click', e => { if (e.target === confirmarEl) resolverConfirmar(false); });
    confirmarEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolverConfirmar(false); }
    });
  }

  function pedirConfirmacion(nombre, cb) {
    if (!confirmarEl) construirConfirmar();
    alResolverConfirmar = cb;
    const id = identidad(nombre);
    const av = confirmarEl.querySelector('.usr-avatar');
    av.style.setProperty('--tono', id.tono);
    av.innerHTML = svgAvatar(id);
    confirmarEl.querySelector('.usr-clave-titulo').textContent = '¿Entrar como ' + nombre + '?';
    confirmarEl.querySelector('.usr-confirmar-sub').innerHTML =
      `<strong>${esc(nombre)}</strong> figura conectado en otro equipo. Al confirmar, esa caja se cierra ` +
      'y vuelve a la pantalla de selección de usuario. Usalo sólo si esa caja quedó cerrada o colgada.';
    confirmarEl.hidden = false;
    // El foco arranca en Cancelar: un Enter apurado no cierra otra caja.
    setTimeout(() => confirmarEl.querySelector('.usr-clave-cancelar').focus(), 60);
  }

  function resolverConfirmar(ok) {
    if (!confirmarEl || confirmarEl.hidden) return;
    confirmarEl.hidden = true;
    const cb = alResolverConfirmar;
    alResolverConfirmar = null;
    if (cb) cb(ok);
  }

  // ------------------------------------------------------ clave personal --
  // Nodo usuariosClaves/{claveDe(nombre)} = { h, s, t }: h es SHA-256 de
  // "sal:clave". Lo último leído de Firebase queda en localStorage para
  // validar al instante, también si internet tarda.
  let claves = leerCacheClaves();
  let clavesFrescas = false;      // Firebase ya respondió con el selector abierto
  let refClaves = null;
  let esperandoFrescas = [];
  const intentos = {};            // clave → { n, hasta }

  const ICONO_LLAVE = '<circle cx="8" cy="15" r="4.2"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>';
  const ICONO_CANDADO_ABIERTO = '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.7"/>';
  const ICONO_BORRAR = '<path d="M20 6H9l-6 6 6 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z"/><path d="m16 10-4 4M12 10l4 4"/>';

  function svgIcono(trazos, ancho) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (ancho || 1.8) + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + trazos + '</svg>';
  }

  function leerCacheClaves() {
    try {
      const v = JSON.parse(lsGet(LS_CLAVES) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (_) { return {}; }
  }
  function guardarCacheClaves() { lsSet(LS_CLAVES, JSON.stringify(claves)); }

  function hayFirebase() { return typeof firebase !== 'undefined' && !!firebase.apps && firebase.apps.length > 0; }
  function esPersona(nombre) { return !esWhatsapp(nombre) && !esOffline(nombre); }
  // Usuarios genéricos de la planilla (no son una persona en particular): no
  // llevan clave personal ni se les invita a crearla, y no operan la caja
  // (cajaTurno.js). Sus ventas se registran igual.
  const GENERICOS = ['otro'];
  function esGenerico(nombre) { return GENERICOS.includes(String(nombre || '').trim().toLowerCase()); }
  function llevaClave(nombre) { return esPersona(nombre) && !esGenerico(nombre); }
  function tieneClave(nombre) { return !!claves[claveDe(nombre)]; }

  function soltarEsperas() {
    const w = esperandoFrescas;
    esperandoFrescas = [];
    w.forEach(f => f());
  }

  function alCambiarClaves(snap) {
    const v = snap.val();
    claves = {};
    if (v && typeof v === 'object') {
      Object.keys(v).forEach(k => {
        if (v[k] && typeof v[k].h === 'string' && typeof v[k].s === 'string') claves[k] = { h: v[k].h, s: v[k].s };
      });
    }
    guardarCacheClaves();
    clavesFrescas = true;
    soltarEsperas();
    marcarClaves();
  }

  function escucharClaves(si) {
    if (!hayFirebase()) return;
    if (si && !refClaves) {
      refClaves = firebase.database().ref(RUTA_CLAVES);
      refClaves.on('value', alCambiarClaves, err => {
        console.warn('Claves de usuario no disponibles:', err);
        soltarEsperas();
      });
    } else if (!si && refClaves) {
      refClaves.off('value', alCambiarClaves);
      refClaves = null;
      clavesFrescas = false;
    }
  }

  // Antes de dejar pasar a alguien "sin clave" se espera un momento a que
  // responda Firebase: pudo haberla creado recién en otro equipo.
  function esperarClaves(nombre) {
    if (clavesFrescas || !refClaves || tieneClave(nombre)) return Promise.resolve();
    return new Promise(res => {
      const fin = () => { clearTimeout(t); res(); };
      const t = setTimeout(fin, lsGet(LS_CLAVES) !== null ? 1500 : 4000);
      esperandoFrescas.push(fin);
    });
  }

  function hex(buf) { return Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join(''); }
  async function sha256(texto) {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  }

  // Tras MAX_INTENTOS errores seguidos hay que esperar ESPERA_INTENTOS_MS.
  function esperaPendiente(id) {
    const i = intentos[id];
    return i && i.hasta > Date.now() ? i.hasta - Date.now() : 0;
  }
  function anotarError(id, texto) {
    const i = intentos[id] || (intentos[id] = { n: 0, hasta: 0 });
    i.n++;
    if (i.n >= MAX_INTENTOS) {
      i.n = 0;
      i.hasta = Date.now() + ESPERA_INTENTOS_MS;
      return { espera: ESPERA_INTENTOS_MS };
    }
    const quedan = MAX_INTENTOS - i.n;
    return quedan <= 2 ? `${texto} · ${quedan === 1 ? 'queda 1 intento' : 'quedan ' + quedan + ' intentos'}` : texto;
  }

  async function comprobarClave(nombre, pin) {
    const k = claveDe(nombre);
    const espera = esperaPendiente(k);
    if (espera) return { espera };
    const r = claves[k];
    if (!r) return true;   // se la quitaron mientras escribía
    if (await sha256(r.s + ':' + pin) === r.h) {
      delete intentos[k];
      reg(`Clave personal correcta (${nombre})`);
      return true;
    }
    reg(`Clave personal incorrecta (${nombre})`);
    return anotarError(k, 'Clave incorrecta');
  }

  async function comprobarMaestra(pin) {
    const espera = esperaPendiente('*maestra');
    if (espera) return { espera };
    if (await sha256('hp-maestra:' + pin) === HASH_MAESTRA) {
      delete intentos['*maestra'];
      return true;
    }
    reg('Clave maestra incorrecta');
    return anotarError('*maestra', 'Clave maestra incorrecta');
  }

  // Sin conexión Firebase deja la escritura en cola y no responde: pasado un
  // rato se avisa en vez de quedar esperando.
  function conLimite(p, ms) {
    let t;
    return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error('Sin respuesta de Firebase')), ms); })])
      .finally(() => clearTimeout(t));
  }

  async function guardarClave(nombre, pin) {
    if (!hayFirebase()) throw new Error('Firebase no disponible');
    const s = hex(crypto.getRandomValues(new Uint8Array(8)));
    const h = await sha256(s + ':' + pin);
    const k = claveDe(nombre);
    await conLimite(firebase.database().ref(RUTA_CLAVES).child(k)
      .set({ h, s, t: firebase.database.ServerValue.TIMESTAMP }), 8000);
    claves[k] = { h, s };
    guardarCacheClaves();
    delete intentos[k];
    marcarClaves();
  }

  async function borrarClave(nombre) {
    if (!hayFirebase()) throw new Error('Firebase no disponible');
    const k = claveDe(nombre);
    await conLimite(firebase.database().ref(RUTA_CLAVES).child(k).remove(), 8000);
    delete claves[k];
    guardarCacheClaves();
    delete intentos[k];
    marcarClaves();
  }

  // Las que se adivinan mirando la mano: 1111, 1234, 9876…
  function claveObvia(pin) {
    if (/^(\d)\1+$/.test(pin)) return true;
    const d = pin.split('').map(Number);
    const paso = d[1] - d[0];
    return Math.abs(paso) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === paso);
  }

  // Invitación a crear la clave: una vez por día, por persona y equipo.
  function hoy() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function leerInvitaciones() {
    try { const v = JSON.parse(lsGet(LS_INVITACION) || '{}'); return v && typeof v === 'object' ? v : {}; }
    catch (_) { return {}; }
  }
  function invitadoHoy(nombre) { return leerInvitaciones()[claveDe(nombre)] === hoy(); }
  function marcarInvitado(nombre) {
    const v = leerInvitaciones();
    v[claveDe(nombre)] = hoy();
    lsSet(LS_INVITACION, JSON.stringify(v));
  }

  // Candado abierto en la esquina de quien todavía no creó su clave. Sólo
  // cuando se sabe (respondió Firebase alguna vez), para no marcar de más.
  function marcarClaves() {
    if (!grilla) return;
    const conocidas = clavesFrescas || lsGet(LS_CLAVES) !== null;
    tiles().forEach(t => {
      const sin = conocidas && llevaClave(t.dataset.nombre) && !tieneClave(t.dataset.nombre);
      let m = t.querySelector('.usr-tile-sinclave');
      if (sin && !m) {
        m = document.createElement('span');
        m.className = 'usr-tile-sinclave';
        m.title = 'Todavía no creó su clave personal';
        m.innerHTML = svgIcono(ICONO_CANDADO_ABIERTO, 2);
        t.appendChild(m);
      } else if (!sin && m) {
        m.remove();
      }
    });
  }

  // --- tarjeta de la clave: puntos y teclado numérico ---
  // Fuera del overlay, como la de WhatsApp: el selector descarta las teclas
  // imprimibles. Corta la propagación de las teclas para que la caja (Tab al
  // buscador, captura de la pistola) no se las lleve.
  let pinEl, pinCard, pinAvatar, pinTitulo, pinSub, pinPuntos, pinVivo, pinError, pinEnlaces, pinCancelar;
  let pinOp = null, pinValor = '', pinOcupado = false, pinFinEspera = 0, pinTimerEspera = null, pinOcultar = null;

  function construirPin() {
    pinEl = document.createElement('div');
    pinEl.id = 'usrPin';
    pinEl.className = 'usr-clave usr-pin';
    pinEl.hidden = true;
    pinEl.setAttribute('role', 'dialog');
    pinEl.setAttribute('aria-modal', 'true');
    pinEl.setAttribute('aria-labelledby', 'usrPinTitulo');
    pinEl.setAttribute('aria-describedby', 'usrPinSub');
    const teclas = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
      `<button type="button" class="usr-pin-tecla" data-digito="${n}">${n}</button>`).join('');
    pinEl.innerHTML = `
      <div class="usr-clave-card usr-pin-card" tabindex="-1">
        <span class="usr-avatar usr-clave-avatar" aria-hidden="true"></span>
        <h2 id="usrPinTitulo" class="usr-clave-titulo"></h2>
        <p id="usrPinSub" class="usr-clave-sub"></p>
        <div class="usr-pin-puntos" aria-hidden="true"></div>
        <div class="usr-pin-vivo" role="status" aria-live="polite"></div>
        <div class="usr-clave-error usr-pin-error" role="alert"></div>
        <div class="usr-pin-teclado">
          ${teclas}
          <span class="usr-pin-hueco" aria-hidden="true"></span>
          <button type="button" class="usr-pin-tecla" data-digito="0">0</button>
          <button type="button" class="usr-pin-tecla usr-pin-borrar" aria-label="Borrar el último número">${svgIcono(ICONO_BORRAR, 1.8)}</button>
        </div>
        <div class="usr-pin-enlaces"></div>
        <button type="button" class="usr-clave-btn usr-clave-cancelar usr-pin-cancelar">Cancelar</button>
      </div>`;
    document.body.appendChild(pinEl);
    pinCard = pinEl.querySelector('.usr-pin-card');
    pinAvatar = pinEl.querySelector('.usr-clave-avatar');
    pinTitulo = pinEl.querySelector('.usr-clave-titulo');
    pinSub = pinEl.querySelector('.usr-clave-sub');
    pinPuntos = pinEl.querySelector('.usr-pin-puntos');
    pinVivo = pinEl.querySelector('.usr-pin-vivo');
    pinError = pinEl.querySelector('.usr-pin-error');
    pinEnlaces = pinEl.querySelector('.usr-pin-enlaces');
    pinCancelar = pinEl.querySelector('.usr-pin-cancelar');

    pinEl.querySelector('.usr-pin-teclado').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('usr-pin-borrar')) borrarDigito();
      else teclear(b.dataset.digito);
    });
    pinEnlaces.addEventListener('click', e => {
      const b = e.target.closest('[data-enlace]');
      if (b && pinOp && !pinOcupado) finPin({ enlace: b.dataset.enlace });
    });
    pinCancelar.addEventListener('click', () => { if (!pinOcupado) finPin(null); });
    pinEl.addEventListener('click', e => { if (e.target === pinEl && !pinOcupado) finPin(null); });
    pinEl.addEventListener('keydown', e => {
      e.stopPropagation();
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        teclear(e.key);
        marcarTecla(e.key);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        borrarDigito();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (!pinOcupado) finPin(null);
      } else if (e.key === 'Tab') {
        // Trampa de foco dentro de la tarjeta.
        const focos = Array.from(pinCard.querySelectorAll('button:not(:disabled)'));
        const i = focos.indexOf(document.activeElement);
        const sig = e.shiftKey ? (i <= 0 ? focos.length - 1 : i - 1) : (i === focos.length - 1 ? 0 : i + 1);
        e.preventDefault();
        if (focos[sig]) focos[sig].focus();
      }
    });
  }

  // Con el teclado físico, la tecla en pantalla se ilumina igual que al tocarla.
  function marcarTecla(d) {
    const b = pinEl.querySelector(`.usr-pin-tecla[data-digito="${d}"]`);
    if (!b) return;
    b.classList.remove('usr-pin-tecla-pulsada');
    void b.offsetWidth;
    b.classList.add('usr-pin-tecla-pulsada');
  }

  // op: { avatar: { tono, svg }, titulo, sub, largo, cancelar, enlaces: [{ id, texto }],
  //       espera (ms), validar(pin) → true | 'mensaje' | { espera } (puede ser async),
  //       exito, exitoSub }
  // Resuelve { pin } si validó, { enlace } si se tocó un enlace o null si se canceló.
  function pedirPin(op) {
    if (!pinEl) construirPin();
    if (pinOp) finPin(null);
    clearTimeout(pinOcultar);
    return new Promise(res => {
      pinOp = Object.assign({ largo: LARGO_CLAVE, cancelar: 'Cancelar', enlaces: [] }, op, { res });
      pinValor = '';
      pinOcupado = false;
      pinFinEspera = 0;
      clearInterval(pinTimerEspera);
      pinAvatar.style.setProperty('--tono', op.avatar.tono);
      pinAvatar.innerHTML = op.avatar.svg;
      pinTitulo.textContent = op.titulo;
      pinSub.textContent = op.sub || '';
      pinPuntos.innerHTML = Array.from({ length: pinOp.largo }, () => '<span class="usr-pin-punto"></span>').join('');
      pinPuntos.classList.toggle('usr-pin-puntos-largo', pinOp.largo > LARGO_CLAVE);
      pinError.textContent = '';
      pinEnlaces.innerHTML = pinOp.enlaces.map(x =>
        `<button type="button" class="usr-pin-enlace" data-enlace="${esc(x.id)}">${esc(x.texto)}</button>`).join('');
      pinEnlaces.hidden = !pinOp.enlaces.length;
      pinCancelar.textContent = pinOp.cancelar;
      pinCard.classList.remove('usr-clave-mal', 'usr-pin-ok', 'usr-pin-bloqueado', 'usr-pin-ocupado');
      const visible = !pinEl.hidden;
      pinEl.hidden = false;
      // Entre un paso y el siguiente la tarjeta vuelve a entrar, sin que el
      // velo de fondo parpadee.
      if (visible) {
        pinCard.style.animation = 'none';
        void pinCard.offsetWidth;
        pinCard.style.animation = '';
      }
      pintarPuntos();
      if (pinOp.espera) iniciarEspera(pinOp.espera);
      setTimeout(() => { if (pinOp) pinCard.focus({ preventScroll: true }); }, 60);
    });
  }

  function finPin(resultado) {
    if (!pinOp) return;
    const res = pinOp.res;
    pinOp = null;
    pinOcupado = false;
    clearInterval(pinTimerEspera);
    // Se oculta en la vuelta siguiente: si sigue otro paso, la tarjeta no
    // llega a desaparecer.
    clearTimeout(pinOcultar);
    pinOcultar = setTimeout(() => { if (!pinOp) pinEl.hidden = true; }, 0);
    res(resultado);
  }

  function pintarPuntos() {
    Array.from(pinPuntos.children).forEach((p, i) => p.classList.toggle('lleno', i < pinValor.length));
    pinVivo.textContent = pinValor.length ? `${pinValor.length} de ${pinOp.largo} números` : '';
  }

  function pinEnEspera() { return pinFinEspera > Date.now(); }

  function iniciarEspera(ms) {
    pinFinEspera = Date.now() + ms;
    pinCard.classList.add('usr-pin-bloqueado');
    const tick = () => {
      const s = Math.ceil((pinFinEspera - Date.now()) / 1000);
      if (s <= 0) {
        clearInterval(pinTimerEspera);
        pinCard.classList.remove('usr-pin-bloqueado');
        pinError.textContent = '';
        return;
      }
      pinError.textContent = `Demasiados intentos. Probá de nuevo en ${s} s`;
    };
    clearInterval(pinTimerEspera);
    tick();
    pinTimerEspera = setInterval(tick, 1000);
  }

  function teclear(d) {
    if (!pinOp || pinOcupado || pinEnEspera() || pinValor.length >= pinOp.largo) return;
    pinValor += d;
    pinError.textContent = '';
    pintarPuntos();
    if (pinValor.length === pinOp.largo) validarPin();
  }

  function borrarDigito() {
    if (!pinOp || pinOcupado || !pinValor) return;
    pinValor = pinValor.slice(0, -1);
    pintarPuntos();
  }

  function sacudir() {
    pinCard.classList.remove('usr-clave-mal');
    void pinCard.offsetWidth;
    pinCard.classList.add('usr-clave-mal');
  }

  async function validarPin() {
    const op = pinOp, pin = pinValor;
    pinOcupado = true;
    pinCard.classList.add('usr-pin-ocupado');
    let r;
    try {
      r = op.validar ? await op.validar(pin) : true;
    } catch (err) {
      console.warn('Clave personal:', err);
      r = 'No se pudo completar. Revisá la conexión e intentá de nuevo.';
    }
    if (pinOp !== op) return;   // se cerró mientras validaba
    pinCard.classList.remove('usr-pin-ocupado');
    if (r === true) {
      pinCard.classList.add('usr-pin-ok');
      if (op.exito) {
        pinTitulo.textContent = op.exito;
        pinSub.textContent = op.exitoSub || '';
      }
      pinVivo.textContent = op.exito || 'Clave correcta';
      const pausa = reduceMovimiento() ? 150 : (op.exito ? 1100 : 280);
      setTimeout(() => { if (pinOp === op) finPin({ pin }); }, pausa);
      return;
    }
    pinOcupado = false;
    pinValor = '';
    pintarPuntos();
    sacudir();
    if (r && r.espera) iniciarEspera(r.espera);
    else pinError.textContent = typeof r === 'string' ? r : 'Clave incorrecta';
  }

  // --- recorridos ---
  function avatarDe(nombre) {
    const id = identidad(nombre);
    return { tono: id.tono, svg: svgAvatar(id) };
  }
  const AVATAR_MAESTRA = { tono: '#4b2e83', svg: svgIcono(ICONO_LLAVE, 1.8) };

  // Al elegir a alguien: true si puede entrar. Sin clave entra directo.
  async function verificarEntrada(nombre) {
    if (!llevaClave(nombre)) return true;
    await esperarClaves(nombre);
    if (!tieneClave(nombre)) return true;
    for (;;) {
      const r = await pedirPin({
        avatar: avatarDe(nombre),
        titulo: 'Hola, ' + nombre,
        sub: 'Ingresá tu clave personal para continuar',
        espera: esperaPendiente(claveDe(nombre)),
        enlaces: [{ id: 'olvido', texto: '¿Olvidaste tu clave?' }],
        validar: pin => comprobarClave(nombre, pin)
      });
      if (!r) return false;
      if (!r.enlace) return true;
      // Con la clave maestra se le pone una nueva (o se le quita) y entra.
      if (await flujoMaestra(nombre)) return true;
    }
  }

  // Sólo el encargado. true si se le puso una clave nueva o se le quitó.
  async function flujoMaestra(nombre) {
    const r = await pedirPin({
      avatar: AVATAR_MAESTRA,
      titulo: 'Clave maestra',
      sub: `Solo para el encargado: permite ponerle una clave nueva a ${nombre} o quitarle la que tiene.`,
      largo: LARGO_MAESTRA,
      cancelar: 'Volver',
      espera: esperaPendiente('*maestra'),
      validar: comprobarMaestra
    });
    if (!r) return false;
    reg(`Clave maestra correcta (para ${nombre})`);
    return flujoCrear(nombre, { maestra: true });
  }

  // Elegir la clave y repetirla. true si quedó guardada (o quitada, con la
  // clave maestra).
  async function flujoCrear(nombre, o) {
    o = o || {};
    const teniaClave = tieneClave(nombre);
    for (;;) {
      const primera = await pedirPin({
        avatar: avatarDe(nombre),
        titulo: o.invitacion ? 'Creá tu clave personal'
          : o.maestra ? 'Clave nueva para ' + nombre
          : teniaClave ? 'Elegí tu clave nueva' : 'Creá tu clave personal',
        sub: o.invitacion
          ? 'Con 4 números, nadie más va a poder operar con tu usuario.'
          : 'Elegí 4 números fáciles de recordar para vos y difíciles de adivinar.',
        cancelar: o.invitacion ? 'Más tarde' : 'Cancelar',
        enlaces: o.maestra && teniaClave ? [{ id: 'quitar', texto: 'Quitarle la clave' }] : [],
        validar: pin => claveObvia(pin) ? 'Es muy fácil de adivinar. Probá con otra.' : true
      });
      if (!primera) {
        if (o.invitacion) reg(`${nombre} dejó la clave personal para más tarde`);
        return false;
      }
      if (primera.enlace === 'quitar') {
        try {
          await borrarClave(nombre);
          reg(`Se quitó la clave personal de ${nombre} (clave maestra)`);
          avisar(`${nombre} quedó sin clave personal.`);
          return true;
        } catch (err) {
          console.warn('No se pudo quitar la clave:', err);
          avisar('No se pudo quitar la clave. Revisá la conexión e intentá de nuevo.');
          return false;
        }
      }
      const segunda = await pedirPin({
        avatar: avatarDe(nombre),
        titulo: 'Repetila para confirmar',
        sub: 'Escribí los mismos 4 números otra vez.',
        cancelar: 'Volver',
        exito: 'Clave guardada',
        exitoSub: 'Desde ahora se te va a pedir al elegir tu usuario.',
        validar: async pin => {
          if (pin !== primera.pin) return 'No coincide con la anterior. Probá de nuevo.';
          await guardarClave(nombre, pin);
          return true;
        }
      });
      if (!segunda) continue;   // "Volver": elegir otra vez
      reg(o.maestra ? `Se le puso una clave personal nueva a ${nombre} (clave maestra)`
        : `${nombre} ${teniaClave ? 'cambió' : 'creó'} su clave personal`);
      avisar(`Listo: ${nombre} ya tiene su clave personal.`);
      return true;
    }
  }

  function avisar(texto) { if (estadoEl && abierto) estadoEl.textContent = texto; }

  // "Clave personal", al pie: tocar un nombre crea o cambia su clave en vez
  // de entrar con él.
  // "Cambiar ícono", al lado: tocar un nombre abre la elección de animal.
  // Los dos modos se excluyen entre sí.
  let enModoClave = false, clavePieBtn = null, tituloEl = null, subEl = null;
  let enModoIcono = false, iconoPieBtn = null;

  function ponerModo(modo) {
    enModoClave = modo === 'clave';
    enModoIcono = modo === 'icono';
    if (!overlay) return;
    overlay.classList.toggle('usr-modo-clave', enModoClave);
    overlay.classList.toggle('usr-modo-icono', enModoIcono);
    clavePieBtn.setAttribute('aria-pressed', enModoClave ? 'true' : 'false');
    clavePieBtn.querySelector('.usr-clave-pie-texto').textContent = enModoClave ? 'Volver a elegir usuario' : 'Clave personal';
    iconoPieBtn.setAttribute('aria-pressed', enModoIcono ? 'true' : 'false');
    iconoPieBtn.querySelector('.usr-icono-pie-texto').textContent = enModoIcono ? 'Volver a elegir usuario' : 'Cambiar ícono';
    tituloEl.textContent = enModoClave ? 'Clave personal' : enModoIcono ? 'Cambiar ícono' : 'Selecciona Usuario';
    subEl.textContent = enModoClave ? 'Tocá tu nombre para crear o cambiar tu clave'
      : enModoIcono ? 'Tocá tu nombre para elegir tu animal' : 'Toca tu nombre para continuar';
    if (modo) estadoEl.textContent = '';
  }
  function modoClave(si) { ponerModo(si ? 'clave' : ''); }
  function modoIcono(si) { ponerModo(si ? 'icono' : ''); }

  async function gestionarClave(nombre, tile) {
    if (!llevaClave(nombre) || esperandoClave) return;
    esperandoClave = true;
    try {
      await esperarClaves(nombre);
      let listo = false;
      if (!tieneClave(nombre)) {
        listo = await flujoCrear(nombre);
      } else {
        for (;;) {
          const r = await pedirPin({
            avatar: avatarDe(nombre),
            titulo: 'Cambiar la clave de ' + nombre,
            sub: 'Primero ingresá la clave actual.',
            espera: esperaPendiente(claveDe(nombre)),
            enlaces: [{ id: 'olvido', texto: '¿Olvidaste tu clave?' }],
            validar: pin => comprobarClave(nombre, pin)
          });
          if (!r) break;
          if (r.enlace) {
            if (await flujoMaestra(nombre)) { listo = true; break; }
            continue;
          }
          listo = await flujoCrear(nombre);
          break;
        }
      }
      if (listo && abierto) {
        const texto = estadoEl.textContent;
        modoClave(false);
        estadoEl.textContent = texto;
      }
    } catch (err) {
      console.error('Clave personal:', err);
    } finally {
      esperandoClave = false;
    }
    if (tile && abierto && tile.isConnected) tile.focus({ preventScroll: true });
  }

  // -------------------------------------------------------- ícono propio --
  // Una sola lectura por página, sin quedar escuchando: el ícono de alguien
  // cambia muy de vez en cuando y mientras tanto sirve la caché.
  let iconosLeidos = false;

  function cargarIconos() {
    if (iconosLeidos || !hayFirebase()) return;
    iconosLeidos = true;
    firebase.database().ref(RUTA_ICONOS).once('value').then(snap => {
      const nuevos = limpiarIconos(snap.val());
      if (JSON.stringify(nuevos) === JSON.stringify(iconosElegidos)) return;
      iconosElegidos = nuevos;
      lsSet(LS_ICONOS, JSON.stringify(nuevos));
      repintarAvatares();
    }).catch(err => {
      iconosLeidos = false;
      console.warn('Íconos de usuario no disponibles:', err);
    });
  }

  // Cambia sólo el color y el dibujo: no rearma la grilla ni mueve el foco.
  function repintarAvatares() {
    pintarHeader();
    if (!grilla) return;
    tiles().forEach(t => {
      const id = identidad(t.dataset.nombre);
      t.style.setProperty('--tono', id.tono);
      const av = t.querySelector('.usr-avatar');
      if (av) av.innerHTML = svgAvatar(id);
    });
  }

  // Antes de guardar se relee lo elegido (unos bytes): si otra persona tomó
  // ese animal recién, desde otro equipo, no se repite.
  async function guardarIcono(nombre, animal) {
    const k = claveDe(nombre);
    const fresco = limpiarIconos((await conLimite(firebase.database().ref(RUTA_ICONOS).once('value'), 8000)).val());
    iconosElegidos = fresco;
    lsSet(LS_ICONOS, JSON.stringify(fresco));
    if (Object.keys(fresco).some(otro => otro !== k && fresco[otro] === animal)) {
      throw new Error('ocupado');
    }
    await conLimite(firebase.database().ref(RUTA_ICONOS).child(k).set(animal), 8000);
    iconosElegidos[k] = animal;
    lsSet(LS_ICONOS, JSON.stringify(iconosElegidos));
    reg(`Ícono cambiado (${nombre}: ${animal})`);
  }

  // Tarjeta con todos los animales. Los que ya usa otra persona quedan
  // bloqueados, con su nombre debajo: nunca hay dos iguales.
  let iconosEl, iconosAvatar, iconosTitulo, iconosRes = null, iconosSel = null;

  function construirIconos() {
    iconosEl = document.createElement('div');
    iconosEl.id = 'usrIconos';
    iconosEl.className = 'usr-clave';
    iconosEl.hidden = true;
    iconosEl.setAttribute('role', 'dialog');
    iconosEl.setAttribute('aria-modal', 'true');
    iconosEl.setAttribute('aria-labelledby', 'usrIconosTitulo');
    iconosEl.innerHTML = `
      <div class="usr-clave-card usr-iconos-card">
        <span class="usr-avatar usr-clave-avatar" aria-hidden="true"></span>
        <h2 id="usrIconosTitulo" class="usr-clave-titulo"></h2>
        <p class="usr-clave-sub">Elegí el animal que te va a representar en todas las cajas. Cada uno es de una sola persona. <span class="usr-iconos-libres"></span></p>
        <div class="usr-iconos-grilla" role="radiogroup" aria-labelledby="usrIconosTitulo">
          ${ORDEN_ANIMALES.map((a, i) => `
            <button type="button" class="usr-icono-opcion" role="radio" aria-checked="false"
                    data-animal="${a}" style="--tono:${TONOS[i]}">
              <span class="usr-avatar" aria-hidden="true">${svgAnimal(a)}</span>
              <span class="usr-icono-nombre">${NOMBRE_ANIMAL[a]}</span>
              <span class="usr-icono-dueno"></span>
            </button>`).join('')}
        </div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
          <button type="button" class="usr-clave-btn usr-iconos-ok">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(iconosEl);
    iconosAvatar = iconosEl.querySelector('.usr-clave-avatar');
    iconosTitulo = iconosEl.querySelector('.usr-clave-titulo');
    const grillaIconos = iconosEl.querySelector('.usr-iconos-grilla');
    grillaIconos.addEventListener('click', e => {
      const b = e.target.closest('.usr-icono-opcion');
      if (b) seleccionarIcono(b.dataset.animal);
    });
    iconosEl.querySelector('.usr-clave-cancelar').addEventListener('click', () => resolverIconos(null));
    iconosEl.querySelector('.usr-iconos-ok').addEventListener('click', () => resolverIconos(iconosSel));
    iconosEl.addEventListener('click', e => { if (e.target === iconosEl) resolverIconos(null); });
    iconosEl.addEventListener('keydown', e => {
      // El selector de abajo descarta teclas: esta tarjeta las maneja sola.
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); resolverIconos(null); return; }
      const opciones = Array.from(grillaIconos.querySelectorAll('.usr-icono-opcion'));
      const i = opciones.indexOf(document.activeElement);
      if (e.key === 'Tab') {
        // Trampa de foco: la grilla cuenta como un solo paso.
        const focos = [opciones.find(o => o.getAttribute('aria-checked') === 'true') || opciones[0]]
          .concat(Array.from(iconosEl.querySelectorAll('.usr-clave-btn')));
        const j = focos.indexOf(i >= 0 ? focos[0] : document.activeElement);
        const sig = e.shiftKey ? (j <= 0 ? focos.length - 1 : j - 1) : (j === focos.length - 1 ? 0 : j + 1);
        e.preventDefault();
        focos[sig].focus();
        return;
      }
      if (i < 0) return;
      const columnas = Math.max(1, getComputedStyle(grillaIconos).gridTemplateColumns.split(' ').length);
      const mov = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columnas, ArrowUp: -columnas }[e.key];
      if (!mov) return;
      e.preventDefault();
      // Saltea los ocupados en esa dirección.
      let j = i + mov;
      while (j >= 0 && j < opciones.length && opciones[j].disabled) j += mov;
      const destino = opciones[j];
      if (!destino || destino.disabled) return;
      seleccionarIcono(destino.dataset.animal);
      destino.focus();
    });
  }

  function seleccionarIcono(animal) {
    iconosSel = animal;
    iconosAvatar.style.setProperty('--tono', TONOS[ORDEN_ANIMALES.indexOf(animal)]);
    iconosAvatar.innerHTML = svgAnimal(animal);
    iconosEl.querySelectorAll('.usr-icono-opcion').forEach(o => {
      const si = o.dataset.animal === animal;
      o.setAttribute('aria-checked', si ? 'true' : 'false');
      o.tabIndex = si ? 0 : -1;
    });
  }

  // Resuelve el animal elegido, o null si se canceló.
  function elegirIcono(nombre) {
    if (!iconosEl) construirIconos();
    const propio = claveDe(nombre);
    const duenos = {};
    const enLista = new Set();
    listaIdentidades.filter(esPersonaIcono).forEach(p => {
      enLista.add(claveDe(p));
      if (claveDe(p) === propio) return;
      const a = identidad(p).animal;
      (duenos[a] = duenos[a] || []).push(p);
    });
    // Quien trabaja en otro local de la misma base y ya eligió, también lo ocupa.
    Object.keys(iconosElegidos).forEach(k => {
      const a = iconosElegidos[k];
      if (k !== propio && !enLista.has(k) && a && !duenos[a]) duenos[a] = ['otro local'];
    });
    iconosEl.querySelectorAll('.usr-icono-opcion').forEach(o => {
      const lista = duenos[o.dataset.animal];
      o.disabled = !!lista;
      o.classList.toggle('usr-icono-usado', !!lista);
      o.querySelector('.usr-icono-dueno').textContent = lista ? lista.join(', ') : 'Libre';
      o.title = lista ? 'Ya lo usa ' + lista.join(', ') : NOMBRE_ANIMAL[o.dataset.animal] + ': libre';
    });
    const actualIcono = iconosEl.querySelector(`.usr-icono-opcion[data-animal="${identidad(nombre).animal}"] .usr-icono-dueno`);
    if (actualIcono) actualIcono.textContent = 'Actual';
    const libres = ORDEN_ANIMALES.filter(a => !duenos[a]).length;
    iconosEl.querySelector('.usr-iconos-libres').textContent =
      libres > 1 ? `Quedan ${libres} libres.` : libres === 1 ? 'Queda 1 libre.' : 'No quedan animales libres.';
    iconosTitulo.textContent = 'Ícono de ' + nombre;
    seleccionarIcono(identidad(nombre).animal);
    iconosEl.hidden = false;
    setTimeout(() => {
      const sel = iconosEl.querySelector('.usr-icono-opcion[aria-checked="true"]');
      if (sel && !iconosEl.hidden) sel.focus({ preventScroll: true });
    }, 60);
    return new Promise(res => { iconosRes = res; });
  }

  function resolverIconos(valor) {
    if (!iconosRes) return;
    const res = iconosRes;
    iconosRes = null;
    iconosEl.hidden = true;
    res(valor);
  }

  // Quien tiene clave personal la escribe antes: nadie le cambia el ícono a otro.
  let esperandoIcono = false;
  async function gestionarIcono(nombre, tile) {
    if (!esPersona(nombre) || esperandoIcono || esperandoClave) return;
    esperandoIcono = true;
    try {
      if (llevaClave(nombre)) await esperarClaves(nombre);
      if (llevaClave(nombre) && tieneClave(nombre)) {
        const r = await pedirPin({
          avatar: avatarDe(nombre),
          titulo: 'Cambiar el ícono de ' + nombre,
          sub: 'Ingresá tu clave.',
          espera: esperaPendiente(claveDe(nombre)),
          validar: pin => comprobarClave(nombre, pin)
        });
        if (!r) return;
      }
      const animal = await elegirIcono(nombre);
      if (!animal || !abierto) return;
      if (iconosElegidos[claveDe(nombre)] !== animal) {
        try {
          await guardarIcono(nombre, animal);
        } catch (err) {
          console.warn('Cambiar ícono:', err);
          if (err && err.message === 'ocupado') {
            repintarAvatares();
            avisar('Ese animal lo acaba de elegir otra persona. Tocá tu nombre y elegí otro.');
          } else {
            avisar('No se pudo guardar el ícono. Revisá la conexión e intentá de nuevo.');
          }
          return;
        }
        repintarAvatares();
      }
      modoIcono(false);
      avisar('Listo: el ícono de ' + nombre + ' ahora es ' + NOMBRE_ANIMAL[animal] + '.');
    } catch (err) {
      console.error('Cambiar ícono:', err);
    } finally {
      esperandoIcono = false;
      if (tile && abierto && tile.isConnected) tile.focus({ preventScroll: true });
    }
  }

  function pintarFecha() {
    const el = overlay.querySelector('#usrFecha');
    const txt = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    const fecha = txt.charAt(0).toUpperCase() + txt.slice(1);
    const pv = window.PuntoVenta && PuntoVenta.multiple() ? PuntoVenta.nombre() : '';
    el.textContent = pv ? pv + ' · ' + fecha : fecha;
  }

  // Sin sesión de Firebase (se entró desde el login sin internet) solo se
  // puede usar Offline; si no, va al final cuando no hay conexión.
  function nombresDelSelector(personas) {
    const m = modoOffline();
    if (m && m.soloOffline()) return [m.NOMBRE];
    const nombres = personas.concat(WHATSAPP);
    if (m && m.mostrarEnSelector()) nombres.push(m.NOMBRE);
    return nombres;
  }

  function pintarTiles(personas) {
    listaIdentidades = personas.slice();
    pintarHeader();
    const nombres = nombresDelSelector(personas);
    const ultimo = (actual || lsGet(LS_ULTIMO) || '').toLowerCase();
    grilla.innerHTML = nombres.map((n, i) => {
      const esUltimo = n.toLowerCase() === ultimo;
      const esActual = actual && n.toLowerCase() === actual.toLowerCase();
      const id = identidad(n);
      return `
        <button type="button" class="usr-tile${esUltimo ? ' es-ultimo' : ''}${id.whatsapp ? ' usr-tile-whatsapp' : ''}${id.offline ? ' usr-tile-offline' : ''}${esGenerico(n) ? ' usr-tile-generico' : ''}" role="option"
                aria-selected="${esActual ? 'true' : 'false'}"
                data-nombre="${esc(n)}" style="--tono:${id.tono}; --i:${i}">
          <span class="usr-avatar" aria-hidden="true">${svgAvatar(id)}</span>
          <span class="usr-tile-nombre">${esc(n)}</span>
          <span class="usr-tile-check" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>
          </span>
        </button>`;
    }).join('');
    grilla.dataset.cantidad = String(nombres.length);
    marcarOcupados();
    marcarClaves();
  }

  function pintarCargando() {
    grilla.innerHTML = Array.from({ length: 6 }, (_, i) =>
      `<div class="usr-tile usr-tile-fantasma" style="--i:${i}" aria-hidden="true"><span class="usr-avatar"></span><span class="usr-tile-nombre"></span></div>`
    ).join('');
    estadoEl.textContent = 'Cargando vendedores…';
  }

  function pintarError() {
    grilla.innerHTML = '';
    estadoEl.innerHTML = `No se pudo traer la lista de vendedores.
      <button type="button" class="usr-reintentar">Reintentar</button>`;
    estadoEl.querySelector('.usr-reintentar').addEventListener('click', () => {
      promesaVendedores = null;
      poblar();
    });
  }

  // Pinta lo que haya a mano (caché o respaldo) y lo reemplaza cuando responde
  // la planilla, sin mover el foco si la persona ya estaba navegando.
  function poblar() {
    const inmediato = soloPersonas(cacheVendedores());
    if (inmediato.length) { pintarTiles(inmediato); limpiarEstado(); enfocarInicial(); }
    else pintarCargando();

    cargarVendedores().then(nombres => {
      if (!abierto) return;
      let lista = soloPersonas(nombres);
      if (!lista.length) lista = inmediato.length ? inmediato : soloPersonas(respaldoHtml());
      if (!lista.length) { pintarError(); return; }
      const mismo = JSON.stringify(lista) === JSON.stringify(inmediato);
      if (mismo) return;
      const foco = document.activeElement && document.activeElement.closest && document.activeElement.closest('.usr-tile');
      const nombreFoco = foco ? foco.dataset.nombre : null;
      pintarTiles(lista);
      limpiarEstado();
      const reenfocar = nombreFoco && grilla.querySelector(`.usr-tile[data-nombre="${CSS.escape(nombreFoco)}"]`);
      if (reenfocar) reenfocar.focus({ preventScroll: true }); else enfocarInicial();
    });
  }

  function tiles() { return Array.from(grilla.querySelectorAll('.usr-tile:not(.usr-tile-fantasma)')); }

  function enfocarInicial() {
    const t = grilla.querySelector('.usr-tile[aria-selected="true"]') || grilla.querySelector('.usr-tile.es-ultimo') || tiles()[0];
    if (t) t.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------- teclado --
  // Ojo con la pistola: escribe un código a ráfaga y termina en Enter. Si se
  // escanea con el selector abierto, ese Enter no puede elegir a nadie.
  function teclado(e) {
    if (e.key && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      ultimaTeclaImprimible = Date.now();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && Date.now() - ultimaTeclaImprimible < 150) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Sin salida: el selector sólo se cierra eligiendo a alguien. En
    // "Clave personal", Escape vuelve a la elección normal.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (enModoClave || enModoIcono) ponerModo('');
      return;
    }
    if (e.key === 'Tab') {
      // Trampa de foco: el resto de la página está inert, pero por las dudas.
      const focos = Array.from(overlay.querySelectorAll('button:not([hidden]):not(:disabled)'));
      if (!focos.length) return;
      const i = focos.indexOf(document.activeElement);
      const sig = e.shiftKey ? (i <= 0 ? focos.length - 1 : i - 1) : (i === focos.length - 1 ? 0 : i + 1);
      e.preventDefault();
      focos[sig].focus();
      return;
    }
    const flechas = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 'abajo', ArrowUp: 'arriba', Home: 'inicio', End: 'fin' };
    if (!(e.key in flechas)) return;
    const lista = tiles();
    if (!lista.length) return;
    e.preventDefault();
    const i = Math.max(0, lista.indexOf(document.activeElement));
    const columnas = Math.max(1, getComputedStyle(grilla).gridTemplateColumns.split(' ').length);
    const mov = flechas[e.key];
    let j = i;
    if (mov === 1 || mov === -1) j = i + mov;
    else if (mov === 'abajo') j = i + columnas;
    else if (mov === 'arriba') j = i - columnas;
    else if (mov === 'inicio') j = 0;
    else if (mov === 'fin') j = lista.length - 1;
    j = Math.min(lista.length - 1, Math.max(0, j));
    lista[j].focus();
  }

  // ----------------------------------------------------------- presencia --
  // Misma clave que usa chat.js para cada nombre (las de RTDB no aceptan . $ # [ ] /).
  function claveDe(nombre) {
    return nombre.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'equipo';
  }

  // Claves de los usuarios con alguna pestaña abierta en otro equipo. El
  // usuario de esta misma pestaña no cuenta: su propia conexión no lo bloquea.
  let ocupados = new Set();
  let refPresencia = null;
  let refOffset = null;
  let offsetServidor = 0;
  let presencias = {};

  function alOffset(s) { offsetServidor = s.val() || 0; }

  // Igual que en chat.js: una conexión cuenta mientras exista. Firebase la
  // borra al cerrarse la pestaña; si la caja se apagó de golpe, para eso está
  // "Entrar igual".
  function conexionesVivas(p) {
    if (!p || !p.conexiones) return [];
    return Object.keys(p.conexiones);
  }

  // Quien se acaba de ir (sin conexiones, pero con `ultimaVez` de hace unos
  // segundos) probablemente sólo cambió de pantalla: sigue contando como
  // ocupado un momento, para que nadie tome su usuario en ese hueco.
  function recienSalido(p) {
    return !!p && typeof p.ultimaVez === 'number' &&
      Date.now() + offsetServidor - p.ultimaVez < GRACIA_NAVEGACION_MS;
  }

  let revisionGracia = null;

  function recalcularOcupados() {
    const propia = actual ? claveDe(actual) : '';
    let enGracia = false;
    ocupados = new Set(Object.keys(presencias).filter(k => {
      if (k === propia) return false;
      if (conexionesVivas(presencias[k]).length) return true;
      if (recienSalido(presencias[k])) { enGracia = true; return true; }
      return false;
    }));
    marcarOcupados();
    // Al vencer la gracia se vuelve a mirar, aunque nadie escriba nada.
    clearTimeout(revisionGracia);
    if (enGracia && refPresencia) revisionGracia = setTimeout(recalcularOcupados, 2000);
  }

  function alCambiarPresencia(snap) {
    presencias = snap.val() || {};
    recalcularOcupados();
  }

  function escucharPresencia(si) {
    if (typeof firebase === 'undefined' || !firebase.apps.length) return;
    if (si && !refPresencia) {
      refOffset = firebase.database().ref('.info/serverTimeOffset');
      refOffset.on('value', alOffset);
      refPresencia = firebase.database().ref(RUTA_PRESENCIA);
      refPresencia.on('value', alCambiarPresencia, err => console.warn('Presencia de usuarios no disponible:', err));
      // Una caja que se apagó no avisa: el "Conectado" se cae solo cuando su
      // conexión vence, aunque nadie más escriba en la presencia.
    } else if (!si && refPresencia) {
      refPresencia.off('value', alCambiarPresencia);
      refPresencia = null;
      refOffset.off('value', alOffset);
      refOffset = null;
      clearTimeout(revisionGracia);
    }
  }

  // "Entrar igual": se borran las conexiones del otro equipo y se le deja la
  // marca de expulsión que revisa chat.js. Si ese equipo estaba apagado, la
  // marca nunca se lee y chat.js la limpia con el tiempo.
  function expulsarConexiones(nombre) {
    if (!refPresencia) return;
    const clave = claveDe(nombre);
    const p = presencias[clave];
    if (!p || !p.conexiones) return;
    const cambios = {};
    Object.keys(p.conexiones).forEach(k => {
      cambios['conexiones/' + k] = null;
      cambios['expulsadas/' + k] = firebase.database.ServerValue.TIMESTAMP;
    });
    refPresencia.child(clave).update(cambios)
      .catch(err => console.warn('No se pudo liberar el usuario en el otro equipo:', err));
  }

  function estaOcupado(nombre) { return ocupados.has(claveDe(nombre)); }

  // Actualiza los botones ya pintados sin rehacer la grilla (no mueve el foco).
  function marcarOcupados() {
    if (!grilla) return;
    tiles().forEach(t => {
      const ocupado = estaOcupado(t.dataset.nombre);
      t.classList.toggle('usr-tile-ocupado', ocupado);
      t.setAttribute('aria-disabled', ocupado ? 'true' : 'false');
      t.title = ocupado ? t.dataset.nombre + ' figura conectado en otro equipo. Tocalo si querés entrar igual.' : '';
      // El indicador va debajo del nombre.
      let marca = t.querySelector('.usr-tile-conectado');
      if (ocupado && !marca) {
        marca = document.createElement('span');
        marca.className = 'usr-tile-conectado';
        marca.innerHTML = '<span class="usr-tile-conectado-punto" aria-hidden="true"></span>Conectado';
        t.querySelector('.usr-tile-nombre').after(marca);
      } else if (!ocupado && marca) {
        marca.remove();
      }
    });
  }

  // --------------------------------------------------------- abrir/cerrar --
  function bloquearPagina(si) {
    const main = document.getElementById('mainContainer');
    if (main) main.inert = si;
    document.documentElement.classList.toggle('usr-abierto', si);
  }

  function abrir() {
    construir();
    if (abierto) return;
    abierto = true;
    // Si un modal de la caja quedó abierto, el selector va por encima igual.
    const chatPanel = document.querySelector('.chat-abierto');
    if (chatPanel) chatPanel.classList.remove('chat-abierto');
    // El interruptor arranca prendido sólo si quien suelta la caja tenía
    // puesto fijo; si después elige otra persona, no lo hereda (ver establecer).
    const fijoAntes = esPuestoFijo(actual);
    soltar();
    fijoTocado = false;
    pintarFijo(fijoAntes);
    pintarFecha();
    modoClave(false);
    overlay.classList.remove('usr-saliendo', 'usr-eligiendo');
    overlay.hidden = false;
    bloquearPagina(true);
    // Forzar el estilo inicial antes de animar la entrada.
    void overlay.offsetWidth;
    overlay.classList.add('usr-visible');
    limpiarEstado();
    escucharPresencia(true);
    escucharClaves(true);
    cargarIconos();
    poblar();
  }

  function cerrar() {
    if (!abierto) return;
    abierto = false;
    marcarActividad();
    escucharPresencia(false);
    escucharClaves(false);
    if (pinOp) finPin(null);
    if (iconosRes) resolverIconos(null);
    modoClave(false);
    overlay.classList.remove('usr-visible');
    overlay.classList.add('usr-saliendo');
    bloquearPagina(false);
    const fin = () => {
      overlay.hidden = true;
      overlay.classList.remove('usr-saliendo', 'usr-eligiendo');
    };
    if (reduceMovimiento()) fin();
    else setTimeout(fin, 320);
    // El foco vuelve al campo principal de la pantalla (en la caja, donde
    // escribe la pistola).
    setTimeout(() => {
      const s = document.querySelector('[data-foco-principal]');
      if (s && !s.disabled) s.focus();
    }, 60);
  }

  // WhatsApp pide su contraseña y prende el modo; cualquier persona lo apaga.
  let esperandoClave = false;

  // `forzar` = se confirmó "Entrar igual" sobre alguien que figuraba conectado.
  function elegir(nombre, tile, forzar) {
    if (!nombre || esperandoClave || overlay.classList.contains('usr-eligiendo')) return;
    if (esOffline(nombre)) {
      // Sin presencia ni "Conectado": es el modo de emergencia de esta PC.
      const m = modoOffline();
      if (m.activo()) { confirmarEleccion(m.NOMBRE, tile); return; }
      esperandoClave = true;
      pedirAvisoOffline(ok => {
        esperandoClave = false;
        if (ok) {
          ssDel(SS_MODO_WHATSAPP);
          m.entrar();
          reg('Entró al modo Offline');
          confirmarEleccion(m.NOMBRE, tile);
        } else {
          reg('Canceló la entrada al modo Offline');
          if (tile) tile.focus({ preventScroll: true });
        }
      });
      return;
    }
    // Cualquier persona (o WhatsApp) apaga el modo Offline.
    if (modoOffline() && modoOffline().activo()) modoOffline().salir();
    if (estaOcupado(nombre) && !forzar) {
      ofrecerEntrarIgual(nombre, tile);
      return;
    }
    if (esWhatsapp(nombre)) {
      // Con el modo ya prendido en esta pestaña no se vuelve a pedir.
      if (modoWhatsappActivo()) { confirmarEleccion(WHATSAPP, tile, forzar); return; }
      esperandoClave = true;
      pedirClave(ok => {
        esperandoClave = false;
        reg(ok ? 'Contraseña de WhatsApp correcta' : 'Canceló la contraseña de WhatsApp');
        if (ok) ssSet(SS_MODO_WHATSAPP, '1');
        // Pudo conectarse en otro equipo mientras se escribía la contraseña.
        if (ok && estaOcupado(WHATSAPP) && !forzar) {
          ofrecerEntrarIgual(WHATSAPP, tile);
          if (tile) tile.focus({ preventScroll: true });
        } else if (ok) confirmarEleccion(WHATSAPP, tile, forzar);
        else if (tile) tile.focus({ preventScroll: true });
      });
      return;
    }
    // Clave personal: quien la tiene la escribe antes de entrar.
    esperandoClave = true;
    verificarEntrada(nombre).then(ok => {
      esperandoClave = false;
      if (!abierto) return;
      if (!ok) { if (tile) tile.focus({ preventScroll: true }); return; }
      // Pudo conectarse en otro equipo mientras se escribía la clave.
      if (estaOcupado(nombre) && !forzar) { ofrecerEntrarIgual(nombre, tile); return; }
      // Cualquier persona apaga el modo WhatsApp.
      ssDel(SS_MODO_WHATSAPP);
      confirmarEleccion(nombre, tile, forzar);
    }, err => {
      esperandoClave = false;
      console.error('Clave personal:', err);
      if (abierto) estadoEl.textContent = 'No se pudo verificar la clave. Intentá de nuevo.';
    });
  }

  function ofrecerEntrarIgual(nombre, tile) {
    reg(`Quiso entrar como ${nombre}, pero figura conectado en otro equipo`);
    estadoEl.innerHTML = `${esc(nombre)} figura conectado en otro equipo. Si esa caja ya está cerrada, podés entrar igual.
      <button type="button" class="usr-reintentar">Entrar igual</button>`;
    const btn = estadoEl.querySelector('.usr-reintentar');
    btn.addEventListener('click', () => pedirConfirmacion(nombre, ok => {
      if (ok) elegir(nombre, tile, true);
      else btn.focus({ preventScroll: true });
    }));
  }

  function confirmarEleccion(nombre, tile, forzar) {
    if (forzar) expulsarConexiones(nombre);
    aviso = '';
    overlay.classList.add('usr-eligiendo');
    tiles().forEach(t => t.setAttribute('aria-selected', t === tile ? 'true' : 'false'));
    if (tile) tile.classList.add('es-elegido');
    establecer(nombre);
    // Después de establecer: así la línea ya sale con el usuario nuevo.
    reg(`Eligió el usuario ${nombre}${forzar ? ' (entró igual: se desconectó del otro equipo)' : ''}`);
    // Sin clave personal todavía: se le invita a crearla (una vez por día)
    // antes de cerrar. Sólo si Firebase confirmó que no la tiene.
    const invitar = llevaClave(nombre) && clavesFrescas && !tieneClave(nombre) && !invitadoHoy(nombre);
    // Un instante para que se vea la confirmación sobre el botón tocado.
    setTimeout(() => {
      if (!invitar) { cerrar(); return; }
      marcarInvitado(nombre);
      flujoCrear(nombre, { invitacion: true }).then(() => cerrar(), () => cerrar());
    }, reduceMovimiento() ? 0 : 260);
  }

  // ------------------------------------------------------------- estado --
  // El último usuario que se soltó al abrir el selector: para el que elija
  // después cuenta como "anterior" (así el campo Vendedor se reemplaza).
  let soltado = '';

  // Cambiar de usuario desconecta al actual: chat.js retira su presencia y
  // ese nombre queda libre para otro equipo mientras acá se elige.
  function soltar() {
    if (!actual) return;
    const anterior = actual;
    reg(`${anterior} dejó la caja (se abrió el selector de usuario)`);
    soltado = anterior;
    actual = '';
    ssDel(SS_ACTUAL);
    pintarHeader();
    document.dispatchEvent(new CustomEvent(EVENTO, { detail: { nombre: '', anterior } }));
  }

  function establecer(nombre) {
    const anterior = actual || soltado;
    // Puesto fijo: el que vuelve a entrar conserva lo que dice el interruptor;
    // otra persona sólo queda fija si lo prendió ella misma.
    if (fijoBtn) {
      const prendido = fijoBtn.getAttribute('aria-pressed') === 'true';
      const mismo = anterior && anterior.toLowerCase() === nombre.toLowerCase();
      if (prendido && (mismo || fijoTocado)) lsSet(LS_PUESTO_FIJO, nombre);
      else if (esPuestoFijo(nombre) || (mismo && esPuestoFijo(anterior))) lsDel(LS_PUESTO_FIJO);
    }
    soltado = '';
    actual = nombre;
    ssSet(SS_ACTUAL, nombre);
    lsSet(LS_ULTIMO, nombre);
    pintarHeader();
    document.dispatchEvent(new CustomEvent(EVENTO, { detail: { nombre, anterior } }));
  }

  function pintarHeader() {
    headerBtn = headerBtn || document.getElementById('usuarioActualBtn');
    if (!headerBtn) return;
    const av = headerBtn.querySelector('.usr-chip-avatar');
    const nom = headerBtn.querySelector('.usr-chip-nombre');
    if (actual) {
      const id = identidad(actual);
      av.innerHTML = svgAvatar(id);
      headerBtn.style.setProperty('--tono', id.tono);
      nom.textContent = actual;
      const fijo = esPuestoFijo(actual);
      const lbl = headerBtn.querySelector('.usr-chip-label');
      if (lbl) lbl.textContent = fijo ? 'Puesto fijo' : 'Usuario';
      headerBtn.title = 'Usuario: ' + actual + (fijo ? ' (puesto fijo)' : '') + ' · Cambiar de usuario';
      headerBtn.setAttribute('aria-label', 'Usuario actual: ' + actual + '. Cambiar de usuario');
      headerBtn.hidden = false;
    } else {
      headerBtn.hidden = true;
    }
  }

  cuandoListo(() => {
    construir();
    headerBtn = document.getElementById('usuarioActualBtn');
    if (headerBtn) headerBtn.addEventListener('click', () => abrir());
    pintarHeader();
    // Con sesión, se traen los íconos elegidos (una vez) para el chip.
    if (hayFirebase() && firebase.auth) {
      firebase.auth().onAuthStateChanged(u => { if (u) cargarIconos(); });
    }
  });

  // Se cortó o volvió internet con el selector abierto: aparece o desaparece
  // el botón Offline (solo si cambió la lista, para no mover el foco).
  document.addEventListener('modooffline:cambio', () => {
    if (!abierto || !grilla) return;
    const pintados = tiles().map(t => t.dataset.nombre).join('|');
    if (pintados === nombresDelSelector(listaIdentidades).join('|')) return;
    pintarTiles(listaIdentidades);
    limpiarEstado();
    enfocarInicial();
  });

  // Arranca la consulta a la planilla ya mismo: cuando termine el login la
  // lista suele estar lista. Con la lista fresca se repinta el chip del
  // encabezado.
  listaIdentidades = soloPersonas(cacheVendedores());
  cargarVendedores().then(nombres => {
    const personas = soloPersonas(nombres);
    if (!personas.length) return;
    listaIdentidades = personas;
    cuandoListo(pintarHeader);
  });

  // ---------------------------------------------------------- puesto fijo --
  let fijoBtn = null;
  let fijoTocado = false;
  function esPuestoFijo(nombre) {
    const f = lsGet(LS_PUESTO_FIJO);
    return !!(nombre && f && f.toLowerCase() === nombre.toLowerCase());
  }
  function pintarFijo(si) {
    if (fijoBtn) fijoBtn.setAttribute('aria-pressed', si ? 'true' : 'false');
  }

  // -------------------------------------------------------- inactividad --
  // Pasados 4 minutos sin tocar la pantalla (teclado, mouse, pistola) se
  // vuelve al selector: así quien llega a la caja no vende con el usuario de
  // otro. La pantalla puede frenarlo (la caja lo hace si el pedido tiene
  // artículos) y limpiar lo suyo antes, con UsuarioActivo.alInactividad().
  const INACTIVIDAD_MS = 4 * 60 * 1000;
  let ultimaActividad = Date.now();
  let ganchoInactividad = null;

  function marcarActividad() { ultimaActividad = Date.now(); }
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'input'].forEach(ev =>
    document.addEventListener(ev, marcarActividad, { capture: true, passive: true }));

  // Sólo con la pantalla a la vista: ni con el login de Firebase ni con el
  // selector ya abierto.
  function pantallaEnUso() {
    const main = document.getElementById('mainContainer');
    return !!main && main.style.display !== 'none' && !main.inert;
  }

  setInterval(() => {
    if (!actual || abierto || esPuestoFijo(actual) || !pantallaEnUso()) return;
    if (Date.now() - ultimaActividad < INACTIVIDAD_MS) return;
    const g = ganchoInactividad;
    try {
      if (g && g.puede && !g.puede()) return;
      reg(`Sin uso por ${Math.round(INACTIVIDAD_MS / 60000)} minutos: vuelve al selector`);
      if (g && g.limpiar) g.limpiar();
    } catch (e) {
      console.error('Inactividad:', e);
      return;
    }
    abrir();
  }, 10 * 1000);

  // ------------------------------------------------------ Escape → selector --
  // Con un usuario ya elegido, Escape vuelve al selector sin confirmar. No
  // actúa si otro elemento ya usó la tecla (cerrar un modal, ocultar
  // resultados) ni mientras haya un modal, un diálogo de clave o el chat abiertos.
  function hayModalAbierto() {
    if (document.querySelector('.chat-abierto')) return true;
    if (Array.from(document.querySelectorAll('.modal-overlay')).some(m => m.style.display && m.style.display !== 'none')) return true;
    return Array.from(document.querySelectorAll('.usr-clave, .usr-pin')).some(el => !el.hidden);
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
    if (!actual || abierto || !pantallaEnUso() || hayModalAbierto()) return;
    e.preventDefault();
    reg('Presionó Escape: vuelve al selector de usuario');
    abrir();
  });

  // Pide la clave personal de `nombre` y resuelve true si la escribió bien.
  // Resuelve 'sinclave' si ese usuario todavía no creó una.
  async function verificarClavePersonal(nombre) {
    if (!nombre) return false;
    construir();
    await esperarClaves(nombre);
    if (!tieneClave(nombre)) return 'sinclave';
    const r = await pedirPin({
      avatar: avatarDe(nombre),
      titulo: 'Acceso Admin',
      sub: 'Ingresá tu clave personal, ' + nombre,
      espera: esperaPendiente(claveDe(nombre)),
      validar: pin => comprobarClave(nombre, pin)
    });
    return !!r;
  }

  // ---------------------------------------------------------------- API --
  window.UsuarioActivo = {
    verificarClavePersonal,
    // "Otro" y similares: no operan la caja (cajaTurno.js).
    esGenerico,
    // La pantalla dice si se puede volver al selector por inactividad
    // (`puede`) y qué dejar en blanco antes de hacerlo (`limpiar`).
    alInactividad(gancho) { ganchoInactividad = gancho || null; },
    EVENTO,
    actual: () => actual,
    cargarVendedores,
    abrir: () => cuandoListo(() => abrir()),
    // Lo llama chat.js cuando otro equipo entró con el usuario de esta pestaña
    // ("Entrar igual"): se suelta el usuario y se vuelve a preguntar.
    expulsado(nombre) {
      cuandoListo(() => {
        aviso = (nombre || 'Tu usuario') + ' se abrió en otro equipo. Elegí con qué usuario seguir en esta caja.';
        reg(`${nombre || 'El usuario'} se abrió en otro equipo: esta caja lo soltó`);
        if (abierto) limpiarEstado(); else abrir();
      });
    },
    // Lo llama el script de login cuando hay sesión. Si esta pestaña ya eligió
    // usuario sigue de largo; si no, muestra el selector sobre la caja.
    alAutenticar(mostrarCaja) {
      cuandoListo(() => {
        mostrarCaja();
        if (actual) {
          pintarHeader();
          document.dispatchEvent(new CustomEvent(EVENTO, { detail: { nombre: actual, anterior: '' } }));
          return;
        }
        abrir();
      });
    }
  };
})();
