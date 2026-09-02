/**
 * Autenticación con Firebase Authentication (email + contraseña).
 *
 * La app arranca bloqueada: `esperarSesion()` no resuelve hasta que hay un usuario
 * válido, así que ni la UI ni las suscripciones a la base se activan antes. La sesión
 * queda persistida en el navegador (browserLocalPersistence), de modo que el modal
 * solo aparece la primera vez o después de cerrar sesión.
 *
 * Los usuarios se dan de alta a mano en Firebase Console → Authentication → Users.
 * No hay registro desde la app: es una herramienta interna.
 */

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import { getFirebaseApp } from './firebase-app.js';

let auth = null;

/** Traduce los códigos de error de Firebase a mensajes que le sirvan a quien lo lee. */
function mensajeDeError(error) {
  switch (error?.code) {
    case 'auth/invalid-email':
      return 'El email no tiene un formato válido.';
    case 'auth/missing-password':
      return 'Escribí la contraseña.';
    // Firebase devuelve el mismo código para usuario inexistente y contraseña
    // incorrecta: no conviene aclarar cuál de las dos falló.
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email o contraseña incorrectos.';
    case 'auth/user-disabled':
      return 'Este usuario está deshabilitado.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.';
    case 'auth/network-request-failed':
      return 'No hay conexión con Firebase. Revisá tu internet.';
    default:
      return error?.message || 'No se pudo iniciar sesión.';
  }
}

/* ────────────────────────────── UI del modal ────────────────────────────── */

const modal = document.getElementById('modal-auth');
const form = document.getElementById('form-auth');
const inputEmail = document.getElementById('auth-email');
const inputPass = document.getElementById('auth-pass');
const errorEl = document.getElementById('auth-error');
const btnEntrar = document.getElementById('btn-auth-entrar');
const sesionEl = document.getElementById('sesion');
const sesionEmailEl = document.getElementById('sesion-email');
const btnSalir = document.getElementById('btn-cerrar-sesion');

function abrirModal() {
  if (modal.open) return;
  modal.showModal();
  inputEmail.focus();
}

function mostrarError(mensaje) {
  errorEl.textContent = mensaje;
  errorEl.hidden = !mensaje;
}

/** Bloquea/desbloquea el contenido de la app detrás del modal. */
function setAppBloqueada(bloqueada) {
  document.body.classList.toggle('app--bloqueada', bloqueada);
}

/* ──────────────────────────────── Sesión ──────────────────────────────── */

/**
 * Deja la app bloqueada hasta que haya un usuario autenticado.
 * @returns {Promise<import('firebase/auth').User>} el usuario ya logueado.
 */
export function esperarSesion() {
  auth = getAuth(getFirebaseApp());

  // Si el navegador bloquea el storage (modo privado en algunos casos), la sesión
  // dura lo que la pestaña: preferible eso a no poder entrar.
  const persistenciaLista = setPersistence(auth, browserLocalPersistence).catch(() => {});

  return new Promise((resolve) => {
    let yaResuelto = false;

    persistenciaLista.then(() => {
      onAuthStateChanged(auth, (usuario) => {
        if (usuario) {
          if (yaResuelto) return;
          yaResuelto = true;

          setAppBloqueada(false);
          mostrarError('');
          form.reset();
          if (modal.open) modal.close();

          sesionEmailEl.textContent = usuario.email || 'Sesión iniciada';
          sesionEl.hidden = false;

          resolve(usuario);
          return;
        }

        // Sin usuario: o es el primer arranque, o la sesión se cerró/venció mientras
        // la app estaba abierta. En el segundo caso hay que recargar, porque las
        // suscripciones a la base ya activas quedarían sin permisos.
        if (yaResuelto) {
          window.location.reload();
          return;
        }

        setAppBloqueada(true);
        sesionEl.hidden = true;
        abrirModal();
      });
    });
  });
}

/** Cierra la sesión. El reload lo dispara el propio onAuthStateChanged. */
export async function cerrarSesion() {
  if (!auth) return;
  await signOut(auth);
}

/* ─────────────────────────────── Listeners ─────────────────────────────── */

// El modal no se puede cerrar con Escape: sin sesión no hay nada que mostrar detrás.
modal?.addEventListener('cancel', (evento) => evento.preventDefault());

form?.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarError('');

  const email = inputEmail.value.trim();
  const pass = inputPass.value;

  if (!email || !pass) {
    mostrarError('Completá email y contraseña.');
    return;
  }

  btnEntrar.disabled = true;
  btnEntrar.textContent = 'Ingresando…';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // El cierre del modal y el desbloqueo los hace onAuthStateChanged.
  } catch (error) {
    mostrarError(mensajeDeError(error));
    inputPass.value = '';
    inputPass.focus();
  } finally {
    btnEntrar.disabled = false;
    btnEntrar.textContent = 'Ingresar';
  }
});

btnSalir?.addEventListener('click', async () => {
  btnSalir.disabled = true;
  try {
    await cerrarSesion();
  } finally {
    btnSalir.disabled = false;
  }
});
