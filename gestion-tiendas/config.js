/* ==========================================================================
   CONFIG.JS · gestión de tiendas (repositorio privado)
   --------------------------------------------------------------------------
   Mismo proyecto de Firebase que el catálogo público, más la dirección donde
   está publicado ese catálogo (para armar los enlaces de cada tienda y la
   página para dominio propio).
   ========================================================================== */

// Dirección del catálogo público, con barra final. Si se publica en GitHub
// Pages sin dominio propio: 'https://codew7.github.io/catalog/'.
const SITIO_PUBLICO = 'https://catalog.dev.ar/';

// Proyecto de Firebase compartido por todas las tiendas (el mismo que en el
// config.js del catálogo público).
const firebaseConfig = {
    apiKey: "AIzaSyCG_s0Mw8KQhkIAcwHVUpREHxUo67Om89k",
    authDomain: "catalogosespeciales-c632e.firebaseapp.com",
    databaseURL: "https://catalogosespeciales-c632e-default-rtdb.firebaseio.com",
    projectId: "catalogosespeciales-c632e",
    storageBucket: "catalogosespeciales-c632e.firebasestorage.app",
    messagingSenderId: "986374584043",
    appId: "1:986374584043:web:01cafa2370cfcd4598f0ae"
};
