/* ==========================================================================
   ADMIN-AUTH.JS · login de los paneles (Firebase Authentication)
   --------------------------------------------------------------------------
   Lo usan admin.html (panel de cada tienda, repositorio público) y
   gestion-tiendas.html (gestión de tiendas, repositorio privado). TiendaAuth.asegurarAcceso() resuelve recién cuando hay
   un usuario logueado CON permiso:
     · admins/<uid>: true                  → admin global (todas las tiendas)
     · tiendas/<id>/admins/<uid>: true     → responsable de esa tienda, siempre
                                             que usuarios/<uid>/activo no sea false
   Con { global: true } sólo entra un admin global.

   Además:
     · usuarios/<uid>/debeCambiarClave → pide una contraseña nueva al entrar
       (las cuentas creadas desde la gestión de tiendas nacen con una temporal).
     · Sin permiso, la persona puede "solicitar acceso" (solicitudes/<uid>) y
       la gestión de tiendas la aprueba sin copiar UIDs a mano.
     · "Mi cuenta": nombre y cambio de contraseña.
     · bajas/<uid> (lo escribe la gestión al "Quitar del sistema"): la cuenta
       se borra sola de Authentication la próxima vez que esa persona entra.
       Sin Cloud Functions es la única forma gratuita: una página sólo puede
       borrar la cuenta de quien está logueado, y Firebase exige que haya
       ingresado hace poco (si la sesión es vieja, se la saca y se le pide
       entrar de nuevo, y ahí se borra).
   El permiso real lo hacen cumplir las reglas (database.rules.json); acá sólo
   se evita mostrar un panel que después no va a poder guardar.
   ========================================================================== */
(function () {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const $ = (id) => document.getElementById(id);

    const MENSAJES = {
        'auth/invalid-credential': 'Email o contraseña incorrectos.',
        'auth/invalid-login-credentials': 'Email o contraseña incorrectos.',
        'auth/wrong-password': 'La contraseña no es correcta.',
        'auth/user-not-found': 'Email o contraseña incorrectos.',
        'auth/missing-password': 'Escribí la contraseña.',
        'auth/invalid-email': 'El email no tiene un formato válido.',
        'auth/user-disabled': 'Este usuario está deshabilitado.',
        'auth/email-already-in-use': 'Ya existe una cuenta con ese email.',
        'auth/weak-password': 'La contraseña es muy débil: usá al menos 8 caracteres con letras y números.',
        'auth/requires-recent-login': 'Por seguridad, volvé a ingresar y repetí el cambio.',
        'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
        'auth/network-request-failed': 'Sin conexión. Revisá internet e intentá de nuevo.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
        'auth/cancelled-popup-request': 'Se cerró la ventana de Google antes de terminar.',
        'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permití las ventanas emergentes para este sitio.',
        'auth/operation-not-allowed': 'Este método de ingreso no está habilitado en Firebase (Authentication → Método de acceso).',
        'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados).',
        'PERMISSION_DENIED': 'La base rechazó la operación (permiso denegado). Revisá que estén publicadas las reglas de database.rules.json.'
    };

    function mensajeDe(e) {
        const code = e && e.code;
        if (MENSAJES[code]) return MENSAJES[code];
        if (/permission/i.test(String((e && e.message) || code || ''))) return MENSAJES.PERMISSION_DENIED;
        return 'No se pudo completar: ' + ((e && (e.message || code)) || e);
    }

    // Contraseña aceptable: 8+ caracteres, con letras y números.
    function validarClave(clave) {
        if (!clave || clave.length < 8) return 'La contraseña tiene que tener al menos 8 caracteres.';
        if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(clave) || !/\d/.test(clave)) return 'La contraseña tiene que combinar letras y números.';
        return '';
    }

    // Contraseña temporal legible (sin 0/O, 1/l/I), 10 caracteres.
    function generarClave() {
        const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
        const numeros = '23456789';
        const todo = letras + numeros;
        const r = new Uint32Array(10);
        crypto.getRandomValues(r);
        // Empieza con letra y lleva al menos dos números (posiciones 3 y 7).
        return Array.from(r, (n, i) => {
            const set = i === 0 ? letras : (i === 3 || i === 7 ? numeros : todo);
            return set[n % set.length];
        }).join('');
    }

    const tieneClave = (u) => !!(u && u.providerData && u.providerData.some(p => p.providerId === 'password'));

    async function cambiarClave(actual, nueva) {
        const u = firebase.auth().currentUser;
        const cred = firebase.auth.EmailAuthProvider.credential(u.email, actual);
        await u.reauthenticateWithCredential(cred);
        await u.updatePassword(nueva);
    }

    function campoClave(id, etiqueta, autocomplete) {
        return `<div class="campo"><label for="${id}">${etiqueta}</label>
            <div class="login-clave">
                <input type="password" id="${id}" autocomplete="${autocomplete}" required>
                <button type="button" class="ver-clave" data-para="${id}" aria-label="Mostrar contraseña"><i class="fas fa-eye"></i></button>
            </div></div>`;
    }

    function activarVerClave(raiz) {
        raiz.querySelectorAll('.ver-clave').forEach(b => b.addEventListener('click', () => {
            const i = $(b.dataset.para);
            const ver = i.type === 'password';
            i.type = ver ? 'text' : 'password';
            b.innerHTML = `<i class="fas ${ver ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
            b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
        }));
    }

    function aviso(id, texto, tipo) {
        const e = $(id);
        if (!e) return;
        e.className = tipo === 'ok' ? 'login-ok' : 'login-error';
        e.innerHTML = texto ? `<i class="fas ${tipo === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${esc(texto)}` : '';
        e.hidden = !texto;
    }

    function cargandoBtn(btn, si, textoOcupado) {
        if (!btn) return;
        if (si) { btn.dataset.html = btn.innerHTML; btn.innerHTML = `<span class="spinner spinner-claro"></span>${esc(textoOcupado)}`; }
        else if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
        btn.disabled = si;
    }

    // ---- Pantalla de login ----
    function crearPantalla(opc) {
        const el = document.createElement('div');
        el.id = 'pantallaLogin';
        el.className = 'login';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'loginTitulo');
        el.innerHTML = `
            <div class="login-caja">
                <div class="login-marca"><i class="fas ${opc.global ? 'fa-layer-group' : 'fa-store'}"></i></div>
                <h1 id="loginTitulo">${opc.global ? 'Gestión de tiendas' : 'Panel de la tienda'}</h1>
                <p class="login-sub">${opc.global
                    ? 'Administración de tiendas y usuarios'
                    : `Ingresá para administrar <span class="chip-tienda">${esc(opc.tienda)}</span>`}</p>

                <div class="login-cargando" id="loginCargando"><span class="spinner"></span>Verificando sesión…</div>

                <form id="loginForm" hidden novalidate>
                    <div class="campo"><label for="loginEmail">Email</label><input type="email" id="loginEmail" autocomplete="username" required></div>
                    ${campoClave('loginClave', 'Contraseña', 'current-password')}
                    <p class="login-error" id="loginError" role="alert" hidden></p>
                    <button type="submit" class="btn btn-primario login-btn" id="loginEntrar"><i class="fas fa-right-to-bracket"></i>Ingresar</button>
                    <button type="button" class="btn btn-texto login-link" id="loginOlvide">¿Olvidaste tu contraseña?</button>
                    <div class="login-separador"><span>o</span></div>
                    <button type="button" class="btn login-btn" id="loginGoogle"><i class="fab fa-google"></i>Ingresar con Google</button>
                    ${opc.global ? '' : `<p class="login-sub" style="margin:4px 0 0;text-align:center;font-size:.82rem">¿Todavía no tenés tienda? <a href="${esc(T_BASE() + 'registro')}">Creá la tuya</a></p>`}
                </form>

                <form id="loginCambio" hidden novalidate>
                    <div class="login-aviso"><i class="fas fa-key"></i><span>Es tu primer ingreso: elegí una contraseña nueva, que sólo vos conozcas.</span></div>
                    ${campoClave('cambioActual', 'Contraseña temporal', 'current-password')}
                    ${campoClave('cambioNueva', 'Contraseña nueva', 'new-password')}
                    ${campoClave('cambioRepetir', 'Repetir contraseña nueva', 'new-password')}
                    <small class="ayuda">Al menos 8 caracteres, combinando letras y números.</small>
                    <p class="login-error" id="cambioError" role="alert" hidden></p>
                    <button type="submit" class="btn btn-primario login-btn" id="cambioGuardar"><i class="fas fa-check"></i>Guardar y entrar</button>
                    <button type="button" class="btn btn-texto login-link" data-salir>Salir</button>
                </form>

                <div id="loginSinPermiso" hidden>
                    <div class="login-aviso"><i class="fas fa-lock"></i><span id="sinPermisoTexto"></span></div>
                    <p class="login-error" id="solicitudError" role="alert" hidden></p>
                    <button type="button" class="btn btn-primario login-btn" id="loginSolicitar" hidden><i class="fas fa-paper-plane"></i>Solicitar acceso</button>
                    <button type="button" class="btn login-btn" id="loginOtraCuenta" style="margin-top:10px"><i class="fas fa-right-from-bracket"></i>Usar otra cuenta</button>
                </div>
            </div>`;
        document.body.appendChild(el);
        activarVerClave(el);
        return el;
    }

    function vista(nombre) {
        ['loginCargando', 'loginForm', 'loginCambio', 'loginSinPermiso'].forEach(id => { $(id).hidden = id !== nombre; });
    }

    // Dirección del sitio público (registro.html vive ahí)
    function T_BASE() { return (window.TiendaCore && window.TiendaCore.BASE_SITIO) || '/'; }

    async function leerPermiso(usuario, opc) {
        const db = firebase.database();
        const leer = (ruta) => db.ref(ruta).once('value').then(s => s.val()).catch(() => null);
        const [global, local, perfil] = await Promise.all([
            leer('admins/' + usuario.uid),
            opc.global ? null : leer('tiendas/' + opc.tienda + '/admins/' + usuario.uid),
            leer('usuarios/' + usuario.uid)
        ]);
        if (global === true) return { permitido: true, global: true, perfil };
        if (opc.global) return { permitido: false, motivo: 'global', perfil };
        if (local === true && !(perfil && perfil.activo === false)) return { permitido: true, global: false, perfil };
        return { permitido: false, motivo: (perfil && perfil.activo === false) ? 'suspendido' : 'sinPermiso', perfil };
    }

    // ---- Cuenta dada de baja (bajas/<uid>) ----
    // Devuelve el texto a mostrar en el login, o '' si la cuenta no tiene baja.
    const RECIENTE_MS = 4 * 60 * 1000;   // Firebase pide un ingreso de hace menos de 5 min para borrar
    async function procesarBaja(usuario) {
        const ref = firebase.database().ref('bajas/' + usuario.uid);
        const baja = await ref.once('value').then(s => s.val()).catch(() => null);
        if (!baja) return '';
        const ingreso = Date.parse(usuario.metadata && usuario.metadata.lastSignInTime) || 0;
        if (Date.now() - ingreso < RECIENTE_MS) {
            try {
                // Primero el aviso (después de borrar la cuenta ya no hay permiso)
                await ref.remove();
                try {
                    await usuario.delete();
                    return 'Tu usuario fue dado de baja del sistema y la cuenta se eliminó.';
                } catch (err) {
                    await ref.set(baja).catch(() => {});   // queda pendiente para el próximo ingreso
                }
            } catch (err) {}
        }
        await firebase.auth().signOut().catch(() => {});
        return 'Este usuario fue dado de baja del sistema.';
    }

    // ---- Chip de usuario + "Mi cuenta" ----
    let perfilActual = null;
    let esGlobal = false;

    function salir() {
        const g = $('btnGuardar');
        const sucio = g && !g.disabled && !g.hidden;
        if (sucio && !confirm('Hay cambios sin guardar. ¿Cerrar sesión igual?')) return;
        window.__saliendo = true;
        firebase.auth().signOut().then(() => location.reload());
    }

    function pintarUsuario(usuario) {
        const barra = document.querySelector('.topbar');
        if (!barra || $('usuarioSesion')) return;
        const cont = document.createElement('div');
        cont.id = 'usuarioSesion';
        cont.className = 'usuario-sesion';
        barra.insertBefore(cont, $('estado') || null);
        refrescarChip(usuario);
    }

    function refrescarChip(usuario) {
        const cont = $('usuarioSesion');
        if (!cont) return;
        const nombre = usuario.displayName || (perfilActual && perfilActual.nombre) || usuario.email || 'Mi cuenta';
        cont.innerHTML = `
            <button type="button" class="usuario-boton" id="btnMiCuenta" title="Mi cuenta" aria-label="Mi cuenta">
                <span class="usuario-avatar">${esc(nombre.trim().charAt(0).toUpperCase())}</span>
                <span class="usuario-email ocultar-movil">${esc(usuario.email || nombre)}</span>
            </button>
            <button type="button" class="btn btn-icono btn-texto" id="btnSalir" title="Cerrar sesión" aria-label="Cerrar sesión"><i class="fas fa-right-from-bracket"></i></button>`;
        $('btnSalir').addEventListener('click', salir);
        $('btnMiCuenta').addEventListener('click', abrirMiCuenta);
    }

    function abrirMiCuenta() {
        const u = firebase.auth().currentUser;
        if (!u) return;
        let m = $('modalMiCuenta');
        if (m) m.remove();
        const conClave = tieneClave(u);
        const nombre = u.displayName || (perfilActual && perfilActual.nombre) || '';
        m = document.createElement('div');
        m.id = 'modalMiCuenta';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-caja" role="dialog" aria-modal="true" aria-labelledby="miCuentaTitulo">
                <div class="modal-cabecera">
                    <h2 id="miCuentaTitulo"><i class="fas fa-user-gear"></i>Mi cuenta</h2>
                    <button type="button" class="btn btn-icono btn-texto" data-cerrar aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="modal-cuerpo">
                    <form id="mcDatos" class="campos una" novalidate>
                        <div class="campo"><label>Email</label><input type="email" value="${esc(u.email || '')}" disabled></div>
                        <div class="campo"><label for="mcNombre">Nombre</label><input type="text" id="mcNombre" maxlength="80" value="${esc(nombre)}" autocomplete="name"></div>
                        <p class="login-error" id="mcDatosAviso" hidden></p>
                        <div><button type="submit" class="btn" id="mcGuardarNombre"><i class="fas fa-check"></i>Guardar nombre</button></div>
                    </form>
                    <hr class="separador">
                    ${conClave ? `
                    <form id="mcClave" class="campos una" novalidate>
                        <h3 class="modal-subtitulo">Cambiar contraseña</h3>
                        ${campoClave('mcActual', 'Contraseña actual', 'current-password')}
                        ${campoClave('mcNueva', 'Contraseña nueva', 'new-password')}
                        ${campoClave('mcRepetir', 'Repetir contraseña nueva', 'new-password')}
                        <small class="ayuda">Al menos 8 caracteres, combinando letras y números.</small>
                        <p class="login-error" id="mcClaveAviso" hidden></p>
                        <div><button type="submit" class="btn btn-primario" id="mcGuardarClave"><i class="fas fa-key"></i>Cambiar contraseña</button></div>
                    </form>` : `<p class="ayuda"><i class="fab fa-google"></i> Ingresás con tu cuenta de Google: la contraseña se administra desde Google.</p>`}
                </div>
                <div class="modal-pie">
                    <button type="button" class="btn btn-texto btn-peligro" id="mcSalir"><i class="fas fa-right-from-bracket"></i>Cerrar sesión</button>
                    <button type="button" class="btn" data-cerrar>Listo</button>
                </div>
            </div>`;
        document.body.appendChild(m);
        activarVerClave(m);
        const cerrar = () => { m.classList.add('saliendo'); setTimeout(() => m.remove(), 180); document.removeEventListener('keydown', alEscape); };
        const alEscape = (e) => { if (e.key === 'Escape') cerrar(); };
        document.addEventListener('keydown', alEscape);
        m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-cerrar]')) cerrar(); });
        $('mcSalir').addEventListener('click', salir);

        $('mcDatos').addEventListener('submit', async (e) => {
            e.preventDefault();
            const nuevo = $('mcNombre').value.trim();
            cargandoBtn($('mcGuardarNombre'), true, 'Guardando…');
            try {
                await u.updateProfile({ displayName: nuevo || null });
                if (perfilActual) {
                    await firebase.database().ref('usuarios/' + u.uid + '/nombre').set(nuevo);
                    perfilActual.nombre = nuevo;
                }
                refrescarChip(u);
                aviso('mcDatosAviso', 'Nombre actualizado.', 'ok');
            } catch (err) { aviso('mcDatosAviso', mensajeDe(err)); }
            cargandoBtn($('mcGuardarNombre'), false);
        });

        if (conClave) {
            $('mcClave').addEventListener('submit', async (e) => {
                e.preventDefault();
                const actual = $('mcActual').value, nueva = $('mcNueva').value, rep = $('mcRepetir').value;
                if (!actual) { aviso('mcClaveAviso', 'Escribí tu contraseña actual.'); return; }
                const mal = validarClave(nueva);
                if (mal) { aviso('mcClaveAviso', mal); return; }
                if (nueva !== rep) { aviso('mcClaveAviso', 'Las contraseñas nuevas no coinciden.'); return; }
                if (nueva === actual) { aviso('mcClaveAviso', 'La contraseña nueva tiene que ser distinta de la actual.'); return; }
                cargandoBtn($('mcGuardarClave'), true, 'Cambiando…');
                try {
                    await cambiarClave(actual, nueva);
                    $('mcClave').reset();
                    aviso('mcClaveAviso', 'Listo: tu contraseña nueva ya está activa.', 'ok');
                } catch (err) { aviso('mcClaveAviso', mensajeDe(err)); }
                cargandoBtn($('mcGuardarClave'), false);
            });
        }
        setTimeout(() => $('mcNombre').focus(), 60);
    }

    // ---- Flujo principal ----
    function asegurarAcceso(opciones) {
        const opc = Object.assign({ tienda: 'demo', global: false }, opciones || {});
        if (typeof firebase === 'undefined' || !firebase.auth) {
            return Promise.reject(new Error('Falta cargar Firebase Authentication.'));
        }
        const auth = firebase.auth();
        auth.languageCode = 'es';
        const pantalla = crearPantalla(opc);
        let accesoConcedido = false;
        let resolver;
        let avisoBaja = '';

        const ocupado = (si) => {
            ['loginGoogle', 'loginOlvide'].forEach(id => { $(id).disabled = si; });
            cargandoBtn($('loginEntrar'), si, 'Ingresando…');
        };

        $('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('loginEmail').value.trim();
            const clave = $('loginClave').value;
            if (!email || !clave) { aviso('loginError', 'Completá email y contraseña.'); return; }
            aviso('loginError', '');
            ocupado(true);
            try {
                await auth.signInWithEmailAndPassword(email, clave);
                // La contraseña recién escrita sirve para el cambio obligatorio
                $('cambioActual').value = clave;
            } catch (err) {
                aviso('loginError', mensajeDe(err));
                ocupado(false);
            }
        });

        $('loginOlvide').addEventListener('click', async () => {
            const email = $('loginEmail').value.trim();
            if (!email) { aviso('loginError', 'Escribí tu email arriba y volvé a tocar "¿Olvidaste tu contraseña?".'); $('loginEmail').focus(); return; }
            try {
                await auth.sendPasswordResetEmail(email);
                aviso('loginError', 'Si el email está registrado, te llegó un enlace para crear una contraseña nueva. Revisá también la carpeta de spam.', 'ok');
            } catch (err) {
                aviso('loginError', mensajeDe(err));
            }
        });

        $('loginGoogle').addEventListener('click', async () => {
            aviso('loginError', '');
            try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
            catch (err) { aviso('loginError', mensajeDe(err)); }
        });

        $('loginOtraCuenta').addEventListener('click', () => auth.signOut());
        pantalla.querySelectorAll('[data-salir]').forEach(b => b.addEventListener('click', () => auth.signOut()));

        $('loginSolicitar').addEventListener('click', async () => {
            const u = auth.currentUser;
            if (!u) return;
            cargandoBtn($('loginSolicitar'), true, 'Enviando…');
            try {
                await firebase.database().ref('solicitudes/' + u.uid).set({
                    email: u.email || '',
                    nombre: u.displayName || '',
                    tienda: opc.tienda,
                    fecha: firebase.database.ServerValue.TIMESTAMP
                });
                $('sinPermisoTexto').innerHTML = `Listo: le avisamos al administrador que <strong>${esc(u.email || '')}</strong> quiere administrar esta tienda. Cuando te habilite, recargá esta página.`;
                $('loginSolicitar').hidden = true;
                aviso('solicitudError', '');
            } catch (err) {
                cargandoBtn($('loginSolicitar'), false);
                aviso('solicitudError', mensajeDe(err));
            }
        });

        $('loginCambio').addEventListener('submit', async (e) => {
            e.preventDefault();
            const actual = $('cambioActual').value, nueva = $('cambioNueva').value, rep = $('cambioRepetir').value;
            if (!actual) { aviso('cambioError', 'Escribí la contraseña temporal que te pasaron.'); return; }
            const mal = validarClave(nueva);
            if (mal) { aviso('cambioError', mal); return; }
            if (nueva !== rep) { aviso('cambioError', 'Las contraseñas nuevas no coinciden.'); return; }
            if (nueva === actual) { aviso('cambioError', 'Elegí una contraseña distinta de la temporal.'); return; }
            cargandoBtn($('cambioGuardar'), true, 'Guardando…');
            try {
                await cambiarClave(actual, nueva);
                await firebase.database().ref('usuarios/' + auth.currentUser.uid + '/debeCambiarClave').set(false);
                if (perfilActual) perfilActual.debeCambiarClave = false;
                entrar(auth.currentUser);
            } catch (err) {
                cargandoBtn($('cambioGuardar'), false);
                aviso('cambioError', mensajeDe(err));
            }
        });

        function entrar(usuario) {
            accesoConcedido = true;
            // Sólo para cuentas dadas de alta desde la gestión de tiendas (así el
            // admin global no aparece como un usuario "sin datos").
            if (perfilActual) {
                firebase.database().ref('usuarios/' + usuario.uid + '/ultimoIngreso')
                    .set(firebase.database.ServerValue.TIMESTAMP).catch(() => {});
            }
            pintarUsuario(usuario);
            pantalla.classList.add('saliendo');
            setTimeout(() => pantalla.remove(), 260);
            resolver({ usuario, perfil: perfilActual, global: esGlobal });
        }

        return new Promise(resolve => {
            resolver = resolve;
            auth.onAuthStateChanged(async (usuario) => {
                // Si la sesión se cierra con el panel abierto (otra pestaña,
                // token revocado), se recarga para volver al login.
                if (accesoConcedido) {
                    if (!usuario && !window.__saliendo) location.reload();
                    return;
                }
                if (!usuario) {
                    vista('loginForm');
                    ocupado(false);
                    if (avisoBaja) { aviso('loginError', avisoBaja); avisoBaja = ''; }
                    setTimeout(() => $('loginEmail').focus(), 50);
                    return;
                }
                vista('loginCargando');
                const textoBaja = await procesarBaja(usuario);
                if (textoBaja) {
                    // La sesión ya se cerró (o la cuenta se borró): el próximo
                    // aviso de onAuthStateChanged vuelve al formulario con este texto.
                    avisoBaja = textoBaja;
                    if (!firebase.auth().currentUser) { vista('loginForm'); ocupado(false); aviso('loginError', textoBaja); avisoBaja = ''; }
                    return;
                }
                const r = await leerPermiso(usuario, opc);
                perfilActual = r.perfil || null;
                esGlobal = !!r.global;
                if (!r.permitido) {
                    const quien = `<strong>${esc(usuario.email || usuario.uid)}</strong>`;
                    // Pidió una tienda desde registro.html y todavía no se aprobó
                    const registro = opc.global ? null : await firebase.database().ref('registros/' + usuario.uid).once('value').then(s => s.val()).catch(() => null);
                    if (registro) {
                        $('sinPermisoTexto').innerHTML = `Tu solicitud para crear <strong>${esc(registro.tiendaNombre || registro.tienda)}</strong> está en revisión. Cuando el administrador la apruebe vas a poder entrar con este mismo usuario.`;
                        $('loginSolicitar').hidden = true;
                        vista('loginSinPermiso');
                        ocupado(false);
                        return;
                    }
                    $('sinPermisoTexto').innerHTML =
                        r.motivo === 'global' ? `La cuenta ${quien} no es administradora del sistema.`
                        : r.motivo === 'suspendido' ? `El acceso de ${quien} está suspendido. Comunicate con el administrador.`
                        : `La cuenta ${quien} todavía no tiene permiso para administrar esta tienda.`;
                    $('loginSolicitar').hidden = r.motivo !== 'sinPermiso';
                    cargandoBtn($('loginSolicitar'), false);
                    vista('loginSinPermiso');
                    ocupado(false);
                    return;
                }
                if (perfilActual && perfilActual.debeCambiarClave === true && tieneClave(usuario)) {
                    vista('loginCambio');
                    setTimeout(() => ($('cambioActual').value ? $('cambioNueva') : $('cambioActual')).focus(), 50);
                    return;
                }
                entrar(usuario);
            });
        });
    }

    window.TiendaAuth = { asegurarAcceso, abrirMiCuenta, validarClave, generarClave, mensajeDe };
})();
