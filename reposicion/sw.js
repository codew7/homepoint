// Service worker de Reposición.
// Existe para que Android ofrezca "Instalar app". No guarda copias de la
// página a propósito: cada apertura pide la versión nueva al servidor (el
// sitio ya manda "no-cache"), así nunca queda una versión vieja instalada.
// Sin internet muestra un aviso en vez de la pantalla de error del navegador.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Reposición</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f1f2f4;font-family:system-ui,sans-serif;color:#101216;text-align:center;padding:24px">' +
    '<div><h1 style="font-size:24px;margin:0 0 8px">Sin conexión</h1><p style="color:#6c727d;margin:0 0 20px">Revisá el WiFi o los datos del celular.</p>' +
    '<button onclick="location.reload()" style="font:inherit;font-weight:700;border:0;border-radius:14px;background:#101216;color:#fff;padding:14px 22px">Reintentar</button></div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )));
});
