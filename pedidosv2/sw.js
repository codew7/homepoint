const CACHE = 'despachos-v5';
const SHELL = [
  './pedidosv2.html',
  './config.js',
  './favicon.png',
  './manifest.json'
];

// Cuanto se espera a la red antes de servir la copia cacheada. Con la app
// volviendo del background en Android el primer fetch puede quedarse colgado
// contra una interfaz que todavia no subio: sin este limite el arranque se
// come esa espera entera con la pantalla en blanco.
const RED_TIMEOUT_MS = 2500;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Red primero pero con plazo, y la respuesta buena se guarda para la proxima.
// Si la red no contesta a tiempo o falla, sale la copia cacheada.
async function redConPlazoOCache(request) {
  const cache = await caches.open(CACHE);

  const desdeRed = fetch(request).then(res => {
    // Solo se guardan respuestas completas y validas: un 404 o una respuesta
    // parcial cacheada envenena el arranque siguiente.
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  });

  const cacheada = await cache.match(request);
  if (!cacheada) return desdeRed;   // sin respaldo: no queda mas que esperar

  // Con respaldo disponible, la red compite contra el reloj.
  const plazo = new Promise(resolver => setTimeout(() => resolver(null), RED_TIMEOUT_MS));
  const ganador = await Promise.race([desdeRed.catch(() => null), plazo]);
  return ganador || cacheada;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Solo se gestiona lo propio de la app. Firebase, Google Sheets y los CDN
  // pasan de largo: cachearlos serviria stock o pedidos viejos, y meter al SW
  // en el medio solo les agrega latencia.
  if (url.origin !== self.location.origin) return;

  e.respondWith(redConPlazoOCache(req));
});
