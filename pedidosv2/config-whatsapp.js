// Proyecto Firebase APARTE donde el sincronizador de la PC del local guarda
// las conversaciones de WhatsApp (carpeta WhatsAppSync). pedidosv2 lee todo y
// escribe solo asigManual (correcciones a mano) y despachos (avisos de envio).
// Se copia de Firebase > Configuracion del proyecto > Tus apps > App web.
// Mientras apiKey este vacio, el boton "Ver conversacion" no aparece.
//
// Cada linea de WhatsApp va en su propio nodo: lineas/envios, lineas/munro y
// lineas/caseros. pedidosv2 y controlTransferencias leen la de abajo.
const whatsappRaiz = 'lineas/envios/';
const whatsappFirebaseConfig = {
  apiKey: "AIzaSyCF_i85dn9m3qLz_IsJg7Ls2wF9n5k4gts",
  authDomain: "whatsappsync-e3245.firebaseapp.com",
  databaseURL: "https://whatsappsync-e3245-default-rtdb.firebaseio.com",
  projectId: "whatsappsync-e3245",
  storageBucket: "whatsappsync-e3245.firebasestorage.app",
  messagingSenderId: "190917681916",
  appId: "1:190917681916:web:262dcff2c5b3365db2ed79"
};
