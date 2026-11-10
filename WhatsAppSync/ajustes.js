// Configuracion del sincronizador de WhatsApp.
// Este archivo NO tiene datos secretos. La clave privada va aparte, en
// clave-firebase.json (no se sube a git).

module.exports = {
  // Numero de WhatsApp que se vincula (solo digitos, con 549).
  // Si se escanea el QR con otro telefono, el programa lo rechaza.
  NUMERO_ESPERADO: '5491176460030',

  // URL de la Realtime Database del proyecto Firebase APARTE para WhatsApp.
  // Se copia de Firebase > Realtime Database (arriba de los datos).
  DATABASE_URL: 'https://whatsappsync-e3245-default-rtdb.firebaseio.com',

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
  // se borran pasados estos dias. Sus fotos/documentos NO se tocan.
  DIAS_CURIOSOS: 30,

  // Base de pedidosv2, de donde se sacan los telefonos de los clientes
  // (solo lectura).
  PEDIDOS_DATABASE_URL: 'https://pedidos-87064-default-rtdb.firebaseio.com'
};
