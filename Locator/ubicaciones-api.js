// =====================================================================
//  ubicaciones-api.js
//  Funciones para CONSULTAR el mapa del depósito desde las apps.
//
//  El depósito se divide en GRUPOS fijos (FL, FR, BL, BR, OT) y cada grupo
//  en COLUMNAS numeradas desde 1 (en LocatorPic, cada foto puesta a la
//  derecha de otra es una columna nueva). El programa de la PC
//  (relevar.py) guarda un nodo liviano, uno por producto:
//
//      ubicaciones/mapa/{codigo} = { grupo: "FL", columna: 3,
//                                    orden: 3,    // para ordenar el recorrido
//                                    confianza: "alta" | "media" | "baja",
//                                    estado: "ubicado" | "posible_movido",
//                                    fecha: 1761740000000 }
//
//  (Los relevamientos viejos guardaban { zona: 12, columna: "I" | "D" };
//  se siguen entendiendo hasta que el producto se vuelva a ver.)
//
//  Uso típico en pedidosv2 (igual que armadoVerificados):
//
//      <script src="../Locator/ubicaciones-api.js"></script>
//
//      // 1) Al iniciar: escuchar el mapa (se actualiza solo).
//      escucharUbicaciones(db, () => render());
//
//      // 2) Al dibujar: agrupar la lista por grupo y columna, sin esperar nada.
//      const grupos = ordenarPorZona(Object.values(articulos));
//
//  Requiere que Firebase ya esté inicializado y el usuario logueado.
// =====================================================================

// Si una ubicación tiene más de estos días sin confirmarse, se trata como
// "incierta". El relevamiento es semanal: 15 días = se salteó uno.
const UBICACION_DIAS_VIGENCIA = 15;

// Grupos del depósito, en el orden en que se recorren.
const GRUPOS_DEPOSITO = ['FL', 'FR', 'BL', 'BR', 'OT'];
const NOMBRE_GRUPO = {
  FL: 'Adelante izquierda', FR: 'Adelante derecha',
  BL: 'Atrás izquierda', BR: 'Atrás derecha', OT: 'Otros',
};
const NOMBRE_COLUMNA = { I: 'izquierda', D: 'derecha' };

// Copia en memoria de ubicaciones/mapa: código -> ubicación.
let UBICACIONES = new Map();

// Firebase no acepta . # $ [ ] / en las claves (mismo criterio que pedidosv2).
function claveUbicacion(codigo) {
  return String(codigo).trim().replace(/[.#$\[\]\/]/g, '_');
}

// true si la ubicación dice dónde está (formato nuevo o viejo).
function tieneUbicacion(u) {
  return !!u && (u.grupo != null || u.zona != null);
}

// "FL · Adelante izquierda"
function tituloGrupo(grupo) {
  return grupo + (NOMBRE_GRUPO[grupo] ? ' · ' + NOMBRE_GRUPO[grupo] : '');
}

// "FL · Columna 3"   (formato viejo: "Zona 12 · izquierda")
function textoUbicacion(u) {
  if (!tieneUbicacion(u)) return 'Sin ubicación';
  if (u.grupo != null) return u.grupo + ' · Columna ' + u.columna;
  return 'Zona ' + u.zona + (u.columna ? ' · ' + (NOMBRE_COLUMNA[u.columna] || u.columna) : '');
}

// "FL C3": corto, para chips y para el listado impreso.
function textoCortoUbicacion(u) {
  if (!tieneUbicacion(u)) return '';
  if (u.grupo != null) return u.grupo + ' C' + u.columna;
  return 'Z' + u.zona + (u.columna ? ' ' + (u.columna === 'D' ? 'der' : 'izq') : '');
}

// Decide si una ubicación es confiable o no.
function esUbicacionIncierta(u) {
  if (!tieneUbicacion(u)) return true;
  if (u.estado === 'posible_movido') return true;
  if (u.confianza === 'baja') return true;
  const dias = (Date.now() - (u.fecha || 0)) / 86400000;
  return dias > UBICACION_DIAS_VIGENCIA;
}

// Posición en el recorrido: primero el grupo (FL, FR, BL, BR, OT), después la columna.
function ordenUbicacion(u) {
  if (u.grupo != null) {
    const g = GRUPOS_DEPOSITO.indexOf(u.grupo);
    return (g < 0 ? GRUPOS_DEPOSITO.length : g) * 1000 + (Number(u.columna) || 0);
  }
  return 100000 + u.zona * 2 + (u.columna === 'D' ? 1 : 0);   // formato viejo, al final
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
//   -> { grupo: 'FL', columna: 3, orden: 3, confianza: 'alta',
//        estado: 'ubicado', fecha: ..., incierta: false,
//        texto: 'FL · Columna 3' }     o null si nunca se vio.
async function obtenerUbicacion(codigo, db = firebase.database()) {
  const clave = claveUbicacion(codigo);
  let u = UBICACIONES.get(clave);
  if (!u && !UBICACIONES.size) {
    u = (await db.ref('ubicaciones/mapa/' + clave).once('value')).val();
  }
  return u ? { ...u, incierta: esUbicacionIncierta(u), texto: textoUbicacion(u) } : null;
}

// ---------------------------------------------------------------------
// 3) Agrupar una lista de recolección por grupo y columna
// ---------------------------------------------------------------------
// Recibe la lista (por ejemplo, Object.values(articulos) de pedidosv2):
//   [{ codigo: '123', nombre: 'BALDE 10L', cantidad: 4, ... }, ...]
//
// Devuelve una entrada por columna, en el orden del recorrido (FL columna
// 1, FL columna 2... FR columna 1...) y al final los que no tienen
// ubicación segura. "sector" es el título del grupo del depósito: las
// columnas de un mismo grupo quedan juntas.
//   [
//     { grupo: 'FL', columna: 1, sector: 'FL · Adelante izquierda', titulo: 'Columna 1', items: [...] },
//     { grupo: 'FL', columna: 4, sector: 'FL · Adelante izquierda', titulo: 'Columna 4', items: [...] },
//     { grupo: 'FR', columna: 2, sector: 'FR · Adelante derecha',   titulo: 'Columna 2', items: [...] },
//     { grupo: null, zona: null, titulo: 'Sin ubicación / incierta', items: [...] }
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
    const orden = ordenUbicacion(u);
    if (!grupos.has(orden)) {
      grupos.set(orden, u.grupo != null
        ? { grupo: u.grupo, columna: u.columna, zona: u.grupo, sector: tituloGrupo(u.grupo),
            titulo: 'Columna ' + u.columna, items: [] }
        : { grupo: null, columna: u.columna, zona: u.zona, sector: null,
            titulo: textoUbicacion(u), items: [] });
    }
    grupos.get(orden).items.push(conUbicacion);
  });

  const porNombre = (a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');

  const resultado = [...grupos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) => ({ ...g, items: g.items.sort(porNombre) }));

  if (inciertos.length) {
    resultado.push({ grupo: null, zona: null, columna: null, sector: null,
                     titulo: 'Sin ubicación / incierta', items: inciertos.sort(porNombre) });
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
