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
  DIAS_HISTORIAL: 90
};
