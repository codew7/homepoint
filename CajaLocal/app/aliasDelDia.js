/*
===============================================================================
 aliasDelDia.js - Qué alias corresponde hoy a cada monto
===============================================================================

 La app alias/index.html guarda en el nodo "aliasDelDia" de Firebase cuatro
 alias y dos cortes de monto:

   aliasDelDia: {
     cortes: { bajo: 20000, alto: 100000 },
     rangos: { bajo, medio, alto, envios },   // textos en mayúsculas
     fecha:  "AAAA-MM-DD",                     // día en que se confirmó
     por:    email, ts: número
   }

   monto <  bajo          -> rangos.bajo
   bajo <= monto < alto   -> rangos.medio
   monto >= alto          -> rangos.alto
   envíos (pedidosv2)     -> rangos.envios

 Va aparte del nodo "alias" (la lista de alias, sólo textos) para no romper a
 las pantallas que lo leen. Si un día nadie confirma, siguen los últimos
 alias elegidos: confirmadoHoy() avisa para mostrar la advertencia.

 Uso:
   AliasDelDia.escuchar(db, () => { ... });   // se llama en cada cambio
   AliasDelDia.paraMonto(15000)  -> { alias, rango, etiqueta } o null
   AliasDelDia.envios()          -> alias de envíos o ''
   AliasDelDia.confirmadoHoy()   -> true / false
*/
(function () {
  'use strict';

  const CORTES_DEFECTO = { bajo: 20000, alto: 100000 };

  function pesos(n) {
    return '$' + Math.round(n).toLocaleString('es-AR');
  }

  function fechaHoy() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // Fecha AAAA-MM-DD de hace `dias` días (0 = hoy), en la hora del equipo
  function fechaDe(dias) {
    const d = new Date();
    d.setDate(d.getDate() - (dias || 0));
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function normalizarCortes(c) {
    c = c || {};
    const bajo = Number(c.bajo) > 0 ? Number(c.bajo) : CORTES_DEFECTO.bajo;
    const alto = Number(c.alto) > bajo ? Number(c.alto) : Math.max(CORTES_DEFECTO.alto, bajo + 1);
    return { bajo, alto };
  }

  // Texto de cada rango tal como lo ve el usuario
  function etiquetas(c) {
    c = normalizarCortes(c);
    return {
      bajo: 'Menos de ' + pesos(c.bajo),
      medio: pesos(c.bajo) + ' a ' + pesos(c.alto - 1),
      alto: pesos(c.alto) + ' o más',
      envios: 'Envíos'
    };
  }

  function rangoDeMonto(monto, c) {
    c = normalizarCortes(c);
    if (monto < c.bajo) return 'bajo';
    if (monto < c.alto) return 'medio';
    return 'alto';
  }

  // Una instancia por base de Firebase. Las pantallas de una sola sucursal
  // usan la global (window.AliasDelDia); alias.html crea una por sucursal.
  function crear() {
    let datos = null;
    let ref = null;
    let cb = null;
    const oyentes = [];

    const cortes = () => normalizarCortes(datos && datos.cortes);
    const rango = nombre => String(((datos && datos.rangos) || {})[nombre] || '').trim().toUpperCase();

    function avisar() {
      oyentes.forEach(fn => { try { fn(datos); } catch (e) { console.error(e); } });
    }

    function escuchar(db, fn) {
      if (typeof fn === 'function') oyentes.push(fn);
      if (ref || !db) { if (datos && fn) fn(datos); return; }
      ref = db.ref('aliasDelDia');
      cb = ref.on('value', snap => {
        datos = snap.val() || null;
        avisar();
      }, e => {
        // Sin permiso o sin red: se queda con lo último y se puede reintentar
        ref = null;
        console.warn('No se pudo leer el alias del día:', e && (e.code || e.message));
      });
    }

    function dejar() {
      if (ref && cb) ref.off('value', cb);
      ref = null; cb = null; datos = null;
      oyentes.length = 0;
    }

    return {
      escuchar,
      dejar,
      cortes,
      etiquetas: c => etiquetas(c || cortes()),
      rangoDeMonto: (m, c) => rangoDeMonto(m, c || cortes()),
      fechaHoy,
      fechaDe,
      pesos,
      datos: () => datos,
      hayDatos: () => !!(datos && datos.rangos),
      paraMonto(monto) {
        const n = Number(monto);
        if (!datos || !isFinite(n) || n <= 0) return null;
        const c = cortes();
        const nombre = rangoDeMonto(n, c);
        const alias = rango(nombre);
        if (!alias) return null;
        return { alias, rango: nombre, etiqueta: etiquetas(c)[nombre] };
      },
      envios: () => rango('envios'),
      confirmadoHoy: () => !!(datos && datos.fecha === fechaHoy())
    };
  }

  window.AliasDelDia = Object.assign(crear(), { crear });
})();
