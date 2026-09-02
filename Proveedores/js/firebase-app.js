/**
 * Instancia única de la app de Firebase.
 *
 * Auth y Realtime Database tienen que colgar de la MISMA app: si cada módulo
 * llamara a initializeApp() por su cuenta, la base no vería el token de la sesión
 * y las reglas con `auth != null` rechazarían todas las lecturas.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { firebaseConfig } from './firebase-config.js';

let app = null;

/** Inicializa la app una sola vez. Lanza si la config sigue con placeholders. */
export function getFirebaseApp() {
  if (app) return app;

  if (!firebaseConfig.databaseURL || firebaseConfig.databaseURL.includes('TU_PROYECTO')) {
    throw new Error(
      'Firebase no está configurado. Completá js/firebase-config.js con las credenciales de tu proyecto.'
    );
  }

  app = initializeApp(firebaseConfig);
  return app;
}
