/* ==========================================================================
   store.js · Firebase (RTDB + Storage) para el Panel de Catálogos
   --------------------------------------------------------------------------
   catalogoCMS/
     publicado/{cat}            lo que ven los clientes (lectura pública)
     borrador/{cat}             trabajo en curso (autosave, solo root)
     historial/{cat}/{pushId}   { config, autor, fecha, nota, cambios }
     plantillas/{id}            plantillas propias
   Las reglas están en homepoint/database.rules.munro.json.
   ========================================================================== */
import { normalizar, paraGuardar, clonar, aLista } from './schema.js';

const RAIZ = 'catalogoCMS';
export const SESION = Math.random().toString(36).slice(2, 10);

let db = null;
let storage = null;

export function iniciarFirebase() {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    try { storage = firebase.storage(); } catch (e) { storage = null; }
    return { auth: firebase.auth(), db };
}

export function claveAdmin(email) { return String(email || '').replace('.', ','); }

export async function esRoot(email) {
    try {
        const s = await db.ref('admins/' + claveAdmin(email) + '/rol').once('value');
        return String(s.val() || '').trim().toLowerCase() === 'root';
    } catch (e) {
        return false; // permission_denied => no es admin
    }
}

export async function cargarCatalogo(cat) {
    const [pub, bor] = await Promise.all([
        db.ref(`${RAIZ}/publicado/${cat}`).once('value'),
        db.ref(`${RAIZ}/borrador/${cat}`).once('value')
    ]);
    const publicado = pub.val();
    const borrador = bor.val();
    return {
        publicado: publicado ? normalizar(publicado) : normalizar({}),
        publicadoMeta: (publicado && publicado.meta) || null,
        borrador: borrador ? normalizar(borrador) : (publicado ? normalizar(publicado) : normalizar({})),
        borradorMeta: (borrador && borrador.meta) || null
    };
}

export function escucharPublicado(cat, cb) {
    const ref = db.ref(`${RAIZ}/publicado/${cat}`);
    const fn = ref.on('value', (s) => { const v = s.val(); cb(v ? normalizar(v) : normalizar({}), (v && v.meta) || null); });
    return () => ref.off('value', fn);
}

export function escucharBorrador(cat, cb) {
    const ref = db.ref(`${RAIZ}/borrador/${cat}`);
    const fn = ref.on('value', (s) => { const v = s.val(); if (v) cb(normalizar(v), v.meta || null); });
    return () => ref.off('value', fn);
}

export async function guardarBorrador(cat, cfg, usuario) {
    const datos = paraGuardar(cfg);
    datos.meta = { editor: usuario.email, sesion: SESION, actualizado: firebase.database.ServerValue.TIMESTAMP };
    await db.ref(`${RAIZ}/borrador/${cat}`).set(datos);
}

// Si el contenido de un pop-up, aviso o anuncio cambió, sube su "rev" para que
// vuelva a mostrarse a quienes ya lo habían visto o cerrado.
function subirRevisiones(nuevo, anterior) {
    const prev = {};
    aLista(anterior && anterior.popups).forEach((p) => { prev[p.id] = p; });
    nuevo.popups.forEach((p) => {
        const a = prev[p.id];
        if (!a) return;
        const sin = (o) => { const c = clonar(o); delete c.rev; delete c.activo; delete c.prioridad; return JSON.stringify(c); };
        if (sin(a) !== sin(p)) p.rev = (Number(a.rev) || 0) + 1;
    });
    const e = nuevo.estado, ea = (anterior && anterior.estado) || {};
    if ((e.titulo || '') + (e.mensaje || '') + e.modo !== (ea.titulo || '') + (ea.mensaje || '') + ea.modo) e.rev = (Number(ea.rev) || 0) + 1;
    return nuevo;
}

export async function publicar(cat, cfg, anterior, usuario, nota, cambios) {
    const datos = subirRevisiones(paraGuardar(cfg), anterior);
    const ts = firebase.database.ServerValue.TIMESTAMP;
    const version = (Number(anterior && anterior.meta && anterior.meta.version) || 0) + 1;
    datos.meta = { autor: usuario.email, actualizado: ts, version, nota: nota || '' };
    const clave = db.ref(`${RAIZ}/historial/${cat}`).push().key;
    const borrador = clonar(datos);
    borrador.meta = { editor: usuario.email, sesion: SESION, actualizado: ts };
    await db.ref(RAIZ).update({
        [`publicado/${cat}`]: datos,
        [`borrador/${cat}`]: borrador,
        [`historial/${cat}/${clave}`]: { config: paraGuardar(datos), autor: usuario.email, fecha: ts, nota: nota || '', cambios: cambios || 0, version }
    });
    return normalizar(datos);
}

export async function cargarHistorial(cat, limite = 40) {
    const s = await db.ref(`${RAIZ}/historial/${cat}`).orderByChild('fecha').limitToLast(limite).once('value');
    const lista = [];
    s.forEach((h) => { lista.push(Object.assign({ id: h.key }, h.val())); });
    return lista.reverse();
}

export async function cargarPlantillas() {
    const s = await db.ref(`${RAIZ}/plantillas`).once('value');
    const lista = [];
    s.forEach((p) => { lista.push(Object.assign({ id: p.key }, p.val())); });
    return lista.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
}

export async function guardarPlantilla(nombre, secciones, cfg, usuario) {
    const datos = {};
    secciones.forEach((s) => { if (cfg[s] !== undefined) datos[s] = clonar(cfg[s]); });
    const ref = db.ref(`${RAIZ}/plantillas`).push();
    await ref.set({ nombre, secciones, datos, autor: usuario.email, fecha: firebase.database.ServerValue.TIMESTAMP });
    return ref.key;
}

export async function borrarPlantilla(id) {
    await db.ref(`${RAIZ}/plantillas/${id}`).remove();
}

export async function horaServidor() {
    try {
        const s = await db.ref('.info/serverTimeOffset').once('value');
        return Date.now() + (Number(s.val()) || 0);
    } catch (e) { return Date.now(); }
}

/* ------------------------------------------------------------ imágenes */

// Reduce y convierte a WebP en el navegador antes de subir.
export function comprimirImagen(archivo, anchoMax = 1920, calidad = 0.86) {
    return new Promise((resolve, reject) => {
        if (/svg|gif/i.test(archivo.type)) { resolve({ blob: archivo, ancho: 0, alto: 0, tipo: archivo.type }); return; }
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => {
            const escala = Math.min(1, anchoMax / img.naturalWidth);
            const w = Math.round(img.naturalWidth * escala);
            const h = Math.round(img.naturalHeight * escala);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            c.toBlob((b) => {
                if (!b) { reject(new Error('No se pudo procesar la imagen.')); return; }
                resolve({ blob: b, ancho: w, alto: h, tipo: b.type });
            }, 'image/webp', calidad);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('El archivo no es una imagen válida.')); };
        img.src = url;
    });
}

export function subirImagen(cat, archivo, { anchoMax = 1920, alProgreso } = {}) {
    if (!storage) return Promise.reject(new Error('Firebase Storage no está disponible.'));
    return comprimirImagen(archivo, anchoMax).then(({ blob, ancho, alto, tipo }) => new Promise((resolve, reject) => {
        const base = String(archivo.name || 'imagen').replace(/\.[^.]+$/, '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'imagen';
        const ext = tipo === 'image/webp' ? 'webp' : (tipo.split('/')[1] || 'img').replace('svg+xml', 'svg');
        const ref = storage.ref(`catalogo-cms/${cat}/${Date.now()}-${base}.${ext}`);
        const tarea = ref.put(blob, { contentType: tipo, cacheControl: 'public, max-age=31536000, immutable' });
        tarea.on('state_changed',
            (s) => { if (alProgreso && s.totalBytes) alProgreso(s.bytesTransferred / s.totalBytes); },
            (err) => reject(err),
            async () => resolve({ url: await ref.getDownloadURL(), ancho, alto, bytes: blob.size }));
    }));
}
