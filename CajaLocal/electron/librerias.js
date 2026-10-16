// =============================================================================
//  librerias.js - Librerías externas que la caja guarda en la PC
// =============================================================================
//  La caja carga estas librerías desde internet (CDN). main.js las sirve
//  desde app/vendor/ para que la caja abra aunque no haya conexión (modo
//  Offline, offline.js). Son versiones fijas: el archivo
//  local es idéntico al del CDN.
//
//  scripts/sincronizar.js las baja a app/vendor/ antes de armar el instalador.
//  Si una pantalla cambia de versión, la URL nueva va acá (la vieja se borra).
// =============================================================================

module.exports = [
  { url: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js', archivo: 'firebase-app-compat-10.12.0.js' },
  { url: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js', archivo: 'firebase-database-compat-10.12.0.js' },
  { url: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js', archivo: 'firebase-storage-compat-10.12.0.js' },
  { url: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js', archivo: 'firebase-auth-compat-10.12.0.js' },
  { url: 'https://code.jquery.com/jquery-3.6.0.min.js', archivo: 'jquery-3.6.0.min.js' },
  { url: 'https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js', archivo: 'select2-4.1.0-rc.0.min.js' },
  { url: 'https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css', archivo: 'select2-4.1.0-rc.0.min.css' },
  { url: 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js', archivo: 'qz-tray-2.2.4.js' }
];
