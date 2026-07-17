/**
 * Configuración de Firebase.
 *
 * COMPLETAR con las credenciales del proyecto:
 * Firebase Console → Configuración del proyecto → Tus apps → App web → SDK setup
 *
 * IMPORTANTE: databaseURL es obligatorio para Realtime Database.
 * Se ve así: https://<PROJECT_ID>-default-rtdb.firebaseio.com
 * (o https://<PROJECT_ID>-default-rtdb.<REGION>.firebasedatabase.app si elegiste
 *  una región distinta de us-central1)
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyBddoeu1PYbEWP98v-OoHv1VyobpjrgqGY',
  authDomain: 'proveedores-98f1d.firebaseapp.com',
  databaseURL: 'https://proveedores-98f1d-default-rtdb.firebaseio.com',
  projectId: 'proveedores-98f1d',
  storageBucket: 'proveedores-98f1d.firebasestorage.app',
  messagingSenderId: '136770371676',
  appId: '1:136770371676:web:5bceb52468f48a07b82699',
};

/** Nodos raíz de la base. Centralizados para no repetir strings sueltos. */
export const DB_PATHS = {
  proveedores: 'proveedores',
  facturas: 'facturas',
  pagos: 'pagos',
  config: 'config',
};
