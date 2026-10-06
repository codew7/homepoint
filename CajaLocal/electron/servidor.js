// =============================================================================
//  servidor.js - Servidor local de la Caja HomePoint (reemplaza servidor.ps1)
// =============================================================================
//  Publica la carpeta "app" en http://localhost:8123. La caja no se puede abrir
//  como archivo suelto (file://): Firebase Auth rechaza el login, el Service
//  Worker de fotos no se registra y Google Sheets corta por CORS. Servida desde
//  localhost, el navegador la trata como un sitio normal.
//
//  Los puertos son los mismos de siempre (8123, 8124 y 8125), porque son los
//  que figuran en Firebase (dominio autorizado "localhost") y en los referrers
//  de la API key de Sheets. Cambiarlos obligaría a tocar las dos consolas.
//
//  Escucha en 127.0.0.1 y en ::1: Chromium puede resolver "localhost" a
//  cualquiera de los dos y la caja tiene que responder en ambos.
// =============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTOS = [8123, 8124, 8125];
const PAGINA_INICIAL = 'ingresoPedidoV2.html';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const PAGINA_404 = (ruta) => `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;color:#2b2d31"><h2>No se encontró el archivo</h2><p><code>${ruta.replace(/[<>&]/g, '')}</code></p><p>Falta un archivo de la caja. Reinstalá Caja HomePoint.</p></body>`;

function crearManejador(raiz, log) {
  const raizNormalizada = path.resolve(raiz);

  return (pedido, respuesta) => {
    let ruta;
    try {
      ruta = decodeURIComponent(new URL(pedido.url, 'http://localhost').pathname);
    } catch {
      respuesta.writeHead(400).end();
      return;
    }

    if (ruta === '/' || ruta === '') {
      respuesta.writeHead(302, { Location: '/' + PAGINA_INICIAL }).end();
      return;
    }

    // Nadie puede pedir archivos de afuera de "app" con rutas tipo ../../
    const destino = path.resolve(raizNormalizada, '.' + ruta);
    if (!destino.startsWith(raizNormalizada + path.sep)) {
      log.warn('Ruta rechazada', ruta);
      respuesta.writeHead(404, { 'Content-Type': TIPOS['.html'] }).end(PAGINA_404(ruta));
      return;
    }

    fs.readFile(destino, (error, contenido) => {
      if (error) {
        log.warn('404', ruta);
        respuesta.writeHead(404, { 'Content-Type': TIPOS['.html'] }).end(PAGINA_404(ruta));
        return;
      }
      respuesta.writeHead(200, {
        'Content-Type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
        // Sin caché: los archivos de la caja cambian con cada actualización y
        // la versión nueva tiene que verse en el primer arranque.
        'Cache-Control': 'no-store, must-revalidate',
        'Content-Length': contenido.length
      });
      respuesta.end(contenido);
    });
  };
}

function escuchar(servidor, puerto, host) {
  return new Promise((resolve, reject) => {
    const alFallar = (error) => reject(error);
    servidor.once('error', alFallar);
    servidor.listen(puerto, host, () => {
      servidor.off('error', alFallar);
      resolve();
    });
  });
}

function cerrar(servidor) {
  return new Promise((resolve) => servidor.close(() => resolve()));
}

// Prueba los puertos en orden y devuelve { puerto, detener }.
async function iniciarServidor(raiz, log) {
  const manejador = crearManejador(raiz, log);

  for (const puerto of PUERTOS) {
    const v4 = http.createServer(manejador);
    try {
      await escuchar(v4, puerto, '127.0.0.1');
    } catch (error) {
      log.warn(`Puerto ${puerto} ocupado (${error.code}): se prueba el siguiente`);
      continue;
    }

    // IPv6 es opcional (hay PCs que lo tienen apagado), pero si el puerto está
    // tomado ahí por otro programa, la caja podría terminar hablando con él.
    let v6 = http.createServer(manejador);
    try {
      await escuchar(v6, puerto, '::1');
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        log.warn(`Puerto ${puerto} ocupado en IPv6: se prueba el siguiente`);
        await cerrar(v4);
        continue;
      }
      v6 = null;
    }

    log.info(`Servidor local en http://localhost:${puerto}/ (raíz: ${raiz})`);
    return {
      puerto,
      detener: async () => {
        await cerrar(v4);
        if (v6) await cerrar(v6);
      }
    };
  }

  throw new Error(`Los puertos ${PUERTOS.join(', ')} están ocupados por otro programa`);
}

module.exports = { iniciarServidor, PAGINA_INICIAL };
