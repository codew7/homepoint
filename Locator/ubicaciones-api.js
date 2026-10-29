// =====================================================================
//  ubicaciones-api.js
//  Funciones para CONSULTAR el mapa de zonas del depósito desde las apps.
//
//  Cada foto del recorrido semanal es una ZONA (1, 2, 3... en el orden en
//  que se recorre el depósito) y tiene dos COLUMNAS: izquierda y derecha.
//  El programa de la PC (relevar.py) guarda un nodo liviano, uno por producto:
//
//      ubicaciones/mapa/{codigo} = { zona: 12, columna: "I" | "D",
//                                    orden: 24,   // para ordenar el recorrido
//                                    confianza: "alta" | "media" | "baja",
//                                    estado: "ubicado" | "posible_movido",
//                                    fecha: 1761740000000 }
//
//  Uso típico en pedidosv2 (igual que armadoVerificados):
//
//      <script src="../Locator/ubicaciones-api.js"></script>
//
//      // 1) Al iniciar: escuchar el mapa (se actualiza solo).
//      escucharUbicaciones(db, () => render());
//
//      // 2) Al dibujar: agrupar la lista por zona, sin esperar nada.
//      const grupos = ordenarPorZona(Object.values(articulos));
//
//  Requiere que Firebase ya esté inicializado y el usuario logueado.
// =====================================================================

// Si una ubicación tiene más de estos días sin confirmarse, se trata como
// "incierta". El relevamiento es semanal: 15 días = se salteó uno.
const UBICACION_DIAS_VIGENCIA = 15;

const NOMBRE_COLUMNA = { I: 'izquierda', D: 'derecha' };

// Copia en memoria de ubicaciones/mapa: código -> ubicación.
let UBICACIONES = new Map();

// Firebase no acepta . # $ [ ] / en las claves (mismo criterio que pedidosv2).
function claveUbicacion(codigo) {
  return String(codigo).trim().replace(/[.#$\[\]\/]/g, '_');
}

// "Zona 12 · izquierda"
function textoUbicacion(u) {
  if (!u || u.zona == null) return 'Sin ubicación';
  return 'Zona ' + u.zona + (u.columna ? ' · ' + (NOMBRE_COLUMNA[u.columna] || u.columna) : '');
}

// Decide si una ubicación es confiable o no.
function esUbicacionIncierta(u) {
  if (!u || u.zona == null) return true;
  if (u.estado === 'posible_movido') return true;
  if (u.confianza === 'baja') return true;
  const dias = (Date.now() - (u.fecha || 0)) / 86400000;
  return dias > UBICACION_DIAS_VIGENCIA;
}

// ---------------------------------------------------------------------
// 1) Escuchar el mapa en vivo
// ---------------------------------------------------------------------
// Descarga ubicaciones/mapa una vez (unos 150 KB con todo el catálogo
// ubicado; Firebase después solo manda los cambios) y queda escuchando:
// cuando la PC guarda un relevamiento nuevo, la app se entera sola.
// "alCambiar" se llama cada vez que llegan datos (por ejemplo, para redibujar).
// Devuelve una función para dejar de escuchar.
function escucharUbicaciones(db = firebase.database(), alCambiar) {
  const ref = db.ref('ubicaciones/mapa');
  const handler = snap => {
    UBICACIONES = new Map(Object.entries(snap.val() || {}));
    if (alCambiar) alCambiar(UBICACIONES);
  };
  ref.on('value', handler, err => console.warn('No se pudieron leer las ubicaciones:', err));
  return () => ref.off('value', handler);
}

// ---------------------------------------------------------------------
// 2) Ubicación de UN producto
// ---------------------------------------------------------------------
// Si ya se está escuchando el mapa, responde al instante desde memoria;
// si no, lo pide a Firebase.
//   -> { zona: 12, columna: 'I', orden: 24, confianza: 'alta',
//        estado: 'ubicado', fecha: ..., incierta: false,
//        texto: 'Zona 12 · izquierda' }     o null si nunca se vio.
async function obtenerUbicacion(codigo, db = firebase.database()) {
  const clave = claveUbicacion(codigo);
  let u = UBICACIONES.get(clave);
  if (!u && !UBICACIONES.size) {
    u = (await db.ref('ubicaciones/mapa/' + clave).once('value')).val();
  }
  return u ? { ...u, incierta: esUbicacionIncierta(u), texto: textoUbicacion(u) } : null;
}

// ---------------------------------------------------------------------
// 3) Agrupar una lista de recolección por zona
// ---------------------------------------------------------------------
// Recibe la lista (por ejemplo, Object.values(articulos) de pedidosv2):
//   [{ codigo: '123', nombre: 'BALDE 10L', cantidad: 4, ... }, ...]
//
// Devuelve grupos en el orden del recorrido (zona 1 izq, zona 1 der,
// zona 2 izq...) y al final los que no tienen ubicación segura:
//   [
//     { zona: 3,  columna: 'I', titulo: 'Zona 3 · izquierda', items: [...] },
//     { zona: 3,  columna: 'D', titulo: 'Zona 3 · derecha',   items: [...] },
//     { zona: 12, columna: 'I', titulo: 'Zona 12 · izquierda', items: [...] },
//     { zona: null, titulo: 'Sin ubicación / incierta', items: [...] }
//   ]
// Cada item conserva sus datos y suma "ubicacion" (o null). En el grupo
// incierto, "ubicacion.texto" dice dónde se lo vio por última vez.
// Es instantánea: usa la copia en memoria de escucharUbicaciones().
function ordenarPorZona(items, mapa = UBICACIONES) {
  const grupos = new Map();       // orden -> grupo
  const inciertos = [];

  (items || []).forEach(item => {
    const u = mapa.get(claveUbicacion(item.codigo)) || null;
    const conUbicacion = {
      ...item,
      ubicacion: u ? { ...u, incierta: esUbicacionIncierta(u), texto: textoUbicacion(u) } : null,
    };
    if (esUbicacionIncierta(u)) {
      inciertos.push(conUbicacion);
      return;
    }
    const orden = u.orden != null ? u.orden : u.zona * 2 + (u.columna === 'D' ? 1 : 0);
    if (!grupos.has(orden)) {
      grupos.set(orden, { zona: u.zona, columna: u.columna, titulo: textoUbicacion(u), items: [] });
    }
    grupos.get(orden).items.push(conUbicacion);
  });

  const porNombre = (a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');

  const resultado = [...grupos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) => ({ ...g, items: g.items.sort(porNombre) }));

  if (inciertos.length) {
    resultado.push({ zona: null, columna: null, titulo: 'Sin ubicación / incierta', items: inciertos.sort(porNombre) });
  }
  return resultado;
}

// Versión "todo en uno" para páginas que no escuchan el mapa:
// lo descarga una vez y agrupa.
async function armarRecorrido(items, db = firebase.database()) {
  if (!UBICACIONES.size) {
    const snap = await db.ref('ubicaciones/mapa').once('value');
    UBICACIONES = new Map(Object.entries(snap.val() || {}));
  }
  return ordenarPorZona(items);
}
