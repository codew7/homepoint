// Service worker mínimo de alias.html: solo existe para que el celular ofrezca
// "Instalar app". No guarda nada en caché: todo va siempre a la red.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
