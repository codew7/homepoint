'use strict';
// =====================================================================
// Actualizacion automatica, sin preguntar nada al operador.
//
// Las versiones nuevas se publican con "publicar-actualizacion.bat" en el
// release fijo "whatsappsync" del repositorio codew7/homepoint (ver
// package.json > build.publish). Cuando hay una version nueva, la app la
// baja en segundo plano, detiene las lineas, se instala en silencio y se
// vuelve a abrir sola (escondida en la bandeja, como siempre).
//
// Cuando enterarse:
//   - Al instante: el script de publicacion escribe { version, t } en
//     actualizacion/ de la base de la linea Envios (lectura publica, ver
//     database.rules.json). Cada PC la escucha por REST (sin clave), tenga
//     o no la linea Envios.
//   - Por las dudas, tambien revisa al arrancar y cada 10 minutos.
//
// Con "npm start" (sin instalar) no hace nada.
// =====================================================================

const MINUTOS_REVISION = 10;

// "1.10.2" > "1.9.9"
function esMasNueva(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function iniciarActualizador({ app, urlBase, log, alCambiar, antesDeInstalar }) {
  if (!app.isPackaged) {
    alCambiar('Sin actualizaciones automáticas (modo prueba)');
    return;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: () => {}, debug: () => {}, warn: () => {},
    error: (m) => log('Actualización: ' + (m && m.message ? m.message : m))
  };

  let revisando = false;
  let instalando = false;
  let ultimoError = '';

  async function revisar() {
    if (revisando || instalando) return;
    revisando = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      const msg = e && e.message ? e.message.split('\n')[0] : String(e);
      // El mismo error cada 10 minutos (por ejemplo, sin internet) se anota una sola vez
      if (msg !== ultimoError) log('Actualización: no se pudo revisar (' + msg + ').');
      ultimoError = msg;
      alCambiar('Versión ' + app.getVersion() + ' · no se pudo revisar si hay otra');
    } finally {
      revisando = false;
    }
  }

  autoUpdater.on('update-available', (info) => {
    ultimoError = '';
    log('Actualización: hay una versión nueva (' + info.version + '). Descargando...');
    alCambiar('Descargando la versión ' + info.version + '...');
  });
  autoUpdater.on('download-progress', (p) => {
    alCambiar('Descargando la versión nueva... ' + Math.floor(p.percent || 0) + '%');
  });
  autoUpdater.on('update-not-available', () => {
    ultimoError = '';
    alCambiar('Versión ' + app.getVersion() + ' · al día');
  });
  autoUpdater.on('update-downloaded', async (info) => {
    if (instalando) return;
    instalando = true;
    log('Actualización: versión ' + info.version + ' descargada. Se instala y la app se vuelve a abrir sola.');
    alCambiar('Instalando la versión ' + info.version + '...');
    try { await antesDeInstalar(); } catch (_) { /* se instala igual */ }
    // Silencioso y vuelve a abrir la app al terminar
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 500);
  });

  // -------------------------------------------------------------------
  // Aviso al instante por Firebase (REST con streaming, sin clave)
  // -------------------------------------------------------------------
  let espera = 5000;
  let avisoReglas = false;
  async function escucharAviso() {
    if (!urlBase || instalando) return;
    try {
      const r = await fetch(urlBase.replace(/\/+$/, '') + '/actualizacion.json', {
        headers: { Accept: 'text/event-stream' }
      });
      if (r.status === 401 || r.status === 403) {
        if (!avisoReglas) log('Actualización: falta publicar las reglas nuevas (database.rules.json) en la base de Envíos. Mientras tanto se revisa cada ' + MINUTOS_REVISION + ' minutos.');
        avisoReglas = true;
        setTimeout(escucharAviso, 30 * 60000);
        return;
      }
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
      espera = 5000;
      const lector = r.body.getReader();
      const deco = new TextDecoder();
      let resto = '';
      let evento = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += deco.decode(value, { stream: true });
        let i;
        while ((i = resto.indexOf('\n')) >= 0) {
          const linea = resto.slice(0, i).replace(/\r$/, '');
          resto = resto.slice(i + 1);
          if (linea.startsWith('event:')) evento = linea.slice(6).trim();
          else if (linea.startsWith('data:') && (evento === 'put' || evento === 'patch')) {
            let d = null;
            try { d = JSON.parse(linea.slice(5)); } catch (_) { d = null; }
            if (!d) continue;
            const version = d.path === '/' ? (d.data && d.data.version) : d.path === '/version' ? d.data : null;
            if (version && esMasNueva(version, app.getVersion())) {
              log('Actualización: aviso de la versión ' + version + '.');
              revisar();
            }
          }
        }
      }
    } catch (_) { /* sin conexion: se reintenta */ }
    espera = Math.min(espera * 2, 5 * 60000);
    setTimeout(escucharAviso, espera);
  }

  alCambiar('Versión ' + app.getVersion());
  setTimeout(() => revisar(), 20000);
  setInterval(() => revisar(), MINUTOS_REVISION * 60000);
  escucharAviso();
}

module.exports = { iniciarActualizador, esMasNueva };
