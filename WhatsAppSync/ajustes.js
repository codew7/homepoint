// Configuracion del sincronizador de WhatsApp.
// Este archivo NO tiene datos secretos. La clave privada va aparte, en
// clave-firebase.json (no se sube a git).
//
// VARIAS LINEAS: la app instalada puede manejar hasta 3 numeros. Todas usan
// el MISMO proyecto de Firebase (DATABASE_URL) y la misma clave; cada linea
// guarda lo suyo en su nodo: lineas/<nodo>/ (ver NODOS). Lo propio de cada
// linea (que nodo es, numero, tipo, base de pedidos) se carga desde la ventana
// de la app y queda en %APPDATA%\WhatsAppSync\lineas\<id>\linea.json.
// NUMERO_ESPERADO y PEDIDOS_DATABASE_URL (marcados LINEA ENVIOS) solo se usan
// para la linea Envios: al pasar una instalacion vieja a lineas y con
// "node index.js" suelto. Las lineas de cobros solo guardan los comprobantes
// del cliente y nuestro mensaje con la palabra "alias" (ver index.js).

module.exports = {
  // (LINEA ENVIOS) Numero de WhatsApp que se vincula (solo digitos, con 549).
  // Si se escanea el QR con otro telefono, el programa lo rechaza.
  NUMERO_ESPERADO: '5491176460030',

  // URL de la Realtime Database del proyecto Firebase de WhatsApp (uno solo
  // para todas las lineas). Ahi tambien va el aviso de actualizacion.
  DATABASE_URL: 'https://whatsappsync-e3245-default-rtdb.firebaseio.com',

  // Lineas posibles: nodo -> nombre y base de pedidos sugerida (se puede
  // cambiar en la ventana). Los datos de cada una van en lineas/<nodo>/.
  NODOS: {
    envios: { nombre: 'Envíos', pedidos: 'https://pedidos-87064-default-rtdb.firebaseio.com' },
    munro: { nombre: 'Munro', pedidos: 'https://pedidos-87064-default-rtdb.firebaseio.com' },
    caseros: { nombre: 'Caseros', pedidos: 'https://homepoint2-pedidos-default-rtdb.firebaseio.com' }
  },
  NODO_POR_DEFECTO: 'envios',

  // Del historial que manda el celular al vincular, cuantos dias se guardan.
  DIAS_HISTORIAL: 90,

  // Fotos que manda el cliente (las propias no se guardan). Se achican hasta
  // FOTO_KB_MAX y se borran solas pasados DIAS_FOTOS dias, para no pasar el
  // 1 GB gratis de la base.
  DIAS_FOTOS: 90,
  FOTO_ANCHO_MAX: 1280,
  FOTO_KB_MAX: 120,

  // Documentos del cliente (PDF o imagen, ej. comprobantes): se guardan como
  // imagen (los PDF, su primera pagina). Un poco mas de calidad para leerlos.
  DOC_KB_MAX: 200,

  // Numeros que nunca hicieron un pedido ("curiosos"): sus mensajes de texto
  // se borran pasados estos dias. Sus comprobantes NO se tocan, y las
  // cotizaciones ("Subtotal $") duran DIAS_FOTOS, como los comprobantes.
  DIAS_CURIOSOS: 30,

  // Asignacion de comprobantes a pedidos: un comprobante solo se asigna a
  // pedidos creados como mucho estos dias antes de recibirlo.
  DIAS_ASIGNAR: 30,

  // (LINEA ENVIOS) Base de pedidosv2, de donde se sacan los telefonos de los clientes y los
  // pedidos para asignar comprobantes (solo lectura).
  PEDIDOS_DATABASE_URL: 'https://pedidos-87064-default-rtdb.firebaseio.com'
};
