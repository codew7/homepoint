/*
===============================================================================
 sincronizar.js - Copia los archivos de la web a la app de escritorio
===============================================================================

 Los archivos de la web (carpeta raiz del repo) son el UNICO original. La
 carpeta CajaLocal/app/ es una copia que arma este script: no se edita a mano.

 Corre solo antes de:
   - publicar una version (PUBLICAR VERSION.bat / npm run publicar),
   - abrir la app para probar (npm start),
   - armar el instalador (npm run dist).

 Uso manual:
   node scripts/sincronizar.js              copia lo que cambio
   node scripts/sincronizar.js --verificar  solo compara, no copia nada

 Ademas revisa que los archivos de la lista no usen otro archivo del sitio que
 no se este copiando (un .css o .js nuevo, una imagen): si pasa, se detiene y
 avisa cual hay que agregar a ARCHIVOS.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..', '..');
const APP = path.resolve(__dirname, '..', 'app');

// Todo lo que necesita la app. Un archivo nuevo que usen estas paginas va aca.
const ARCHIVOS = [
  'ingresoPedidoV2.html',
  'ingresoPedidoV2.css',
  'ingresoPedidoV2.js',
  'historialRecientes.html',
  'login.html',
  'caja-tokens.css',
  'usuarioActivo.css',
  'usuarioActivo.js',
  'chat.css',
  'chat.js',
  'sw-imagenes.js',
  // Punto de venta del equipo: elige cuál config de Firebase carga la caja.
  'puntoVenta.js',
  'config.js',
  'config2.js',
  'logo.png',
  'faviconnegro.png'
];

// Tienen las claves de Firebase (una por punto de venta) y pueden no estar en
// GitHub: si en esta PC no estan en la web, se conserva la copia de la app.
const SECRETOS = ['config.js', 'config2.js'];

// Nombres que aparecen en el codigo pero la app no necesita.
const IGNORAR = {
  'index.html': 'panel de la web; login.html lo usa sólo si no le pasan ?redirect=',
  'buscarPedidos.html': 'pantalla de la web; login.html sólo la nombra para elegir el config',
  'pedidosWhatsapp.html': 'pantalla de la web; login.html sólo la nombra para elegir el config',
  'no-disponible.png': 'ingresoPedidoV2.js sólo compara el nombre, no carga la imagen'
};

const soloVerificar = process.argv.includes('--verificar');
const errores = [];
const avisos = [];

function iguales(a, b) {
  if (!fs.existsSync(b)) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

// ---------------------------------------- 1. archivos que faltan en la lista --
// Nombres de archivos locales entre comillas, backticks o paréntesis, como
// "chat.css", 'logo.png', `pagina.html?id=`. Las URLs externas no matchean
// porque llevan ":" y "//".
const REFERENCIA = /["'`(]\.?\/?([A-Za-z0-9_\-/]+\.(?:html|js|css|png|jpe?g|svg|ico|json|webp|gif|woff2?))(?=["'`?#)])/g;

for (const nombre of ARCHIVOS) {
  if (!/\.(html|js|css)$/.test(nombre)) continue;
  const origen = path.join(WEB, nombre);
  if (!fs.existsSync(origen)) continue;
  const texto = fs.readFileSync(origen, 'utf8');
  const vistos = new Set();
  for (const m of texto.matchAll(REFERENCIA)) {
    const ref = m[1];
    if (vistos.has(ref) || ARCHIVOS.includes(ref) || ref in IGNORAR) continue;
    vistos.add(ref);
    if (fs.existsSync(path.join(WEB, ref))) {
      errores.push(`${nombre} usa "${ref}", que no se copia a la app. Agregarlo a ARCHIVOS en scripts/sincronizar.js.`);
    } else {
      avisos.push(`${nombre} menciona "${ref}", que no existe en la web.`);
    }
  }
}

// ------------------------------------------------------------ 2. copiar --
const copiados = [];
const distintos = [];

for (const nombre of ARCHIVOS) {
  const origen = path.join(WEB, nombre);
  const destino = path.join(APP, nombre);
  if (!fs.existsSync(origen)) {
    if (SECRETOS.includes(nombre)) {
      if (!fs.existsSync(destino)) errores.push(`Falta ${nombre} en la web y en la app (las claves de Firebase y de la planilla).`);
      continue;
    }
    errores.push(`Falta ${nombre} en la web.`);
    continue;
  }
  if (iguales(origen, destino)) continue;
  distintos.push(nombre);
  if (!soloVerificar && !errores.length) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origen, destino);
    copiados.push(nombre);
  }
}

// ------------------------------------------- 3. lo que sobra en la app --
if (fs.existsSync(APP)) {
  for (const nombre of fs.readdirSync(APP)) {
    if (!ARCHIVOS.includes(nombre)) avisos.push(`La app tiene "${nombre}", que no esta en la lista (no se usa ni se actualiza).`);
  }
}

// ---------------------------------------------------------- 4. resumen --
for (const a of avisos) console.log(`  [!] ${a}`);
for (const e of errores) console.log(`  [X] ${e}`);

if (errores.length) {
  console.log('  [X] No se copio nada.');
  process.exit(1);
}

if (soloVerificar) {
  if (distintos.length) {
    console.log(`  [X] Distintos de la web: ${distintos.join(', ')}`);
    process.exit(1);
  }
  console.log(`  [OK] La app es igual a la web (${ARCHIVOS.length} archivos).`);
} else if (copiados.length) {
  console.log(`  [OK] Copiados desde la web: ${copiados.join(', ')}`);
} else {
  console.log(`  [OK] La app ya era igual a la web (${ARCHIVOS.length} archivos).`);
}
