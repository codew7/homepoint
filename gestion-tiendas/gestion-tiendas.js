/* ==========================================================================
   GESTION-TIENDAS.JS · gestión de tiendas (sólo admins globales)
   --------------------------------------------------------------------------
   Alta de tiendas y usuarios sin entrar a la consola de Firebase:
     · Las cuentas se crean con una app de Firebase SECUNDARIA, así la sesión
       del administrador no se pisa (createUserWithEmailAndPassword deja
       logueado al usuario nuevo en la app donde se llama).
     · Permisos y registro se escriben juntos, en una sola actualización
       multi-ruta:
         usuarios/<uid>                 { email, nombre, activo, debeCambiarClave, creado, tiendas{} }
         tiendas/<id>/admins/<uid>      true
         tiendas/<id>/meta              { nombre, url, notas, creada }
         tiendas/<id>/estado            { activa, mensaje, desde, pausadaPor }   ← lo lee el catálogo;
                                        pausadaPor 'tienda' = la pausó su responsable (Tienda → Estado)
         tiendas/<id>/baja              { fecha, uid, email, borrarUsuario, motivo? } ← el responsable pide eliminarla
         registros/<uid>                { tiendaNombre, tienda, url?, nombre, email, comentario?, fecha }
                                        ← tienda pedida desde registro.html; al aprobarla se crea todo lo de arriba
         tiendas/<id>/costo             { modo, pct }         ← variable de costos (sin nodo = Descuento Interior)
     · Sin Cloud Functions no se puede borrar una cuenta de Authentication ni
       cambiar la contraseña de otra persona. "Quitar del sistema" le saca
       todo permiso y deja bajas/<uid>: la cuenta se borra sola cuando esa
       persona vuelve a entrar (admin-auth.js). Para la contraseña se manda
       el email de restablecimiento.
   ========================================================================== */
(function () {
    'use strict';

    const T = window.TiendaCore;
    const $ = (id) => document.getElementById(id);
    const esc = T.escaparHtml;
    const TS = () => firebase.database.ServerValue.TIMESTAMP;
    const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    let db = null;
    let yo = null;
    const datos = { tiendas: {}, usuarios: {}, solicitudes: {}, bajas: {}, registros: {}, cargadas: false };
    const logos = {};

    // ======================================================================
    // 1 · UTILIDADES DE INTERFAZ
    // ======================================================================
    function toast(texto, tipo) {
        const t = document.createElement('div');
        t.className = 'toast' + (tipo === 'error' ? ' error' : '');
        t.innerHTML = `<i class="fas ${tipo === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>${esc(texto)}`;
        $('toasts').appendChild(t);
        setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, tipo === 'error' ? 6000 : 3200);
        setTimeout(() => t.remove(), tipo === 'error' ? 6400 : 3600);
    }

    function error(e) {
        console.error(e);
        toast(window.TiendaAuth.mensajeDe(e), 'error');
    }

    function hace(ts) {
        if (!ts) return '';
        const s = Math.round((Date.now() - ts) / 1000);
        if (s < 60) return 'recién';
        const m = Math.round(s / 60);
        if (m < 60) return `hace ${m} min`;
        const h = Math.round(m / 60);
        if (h < 24) return `hace ${h} h`;
        const d = Math.round(h / 24);
        if (d < 30) return `hace ${d} día${d === 1 ? '' : 's'}`;
        return new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function slug(texto) {
        return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    }

    // URL del catálogo → https://… con barra o archivo .html al final
    function normalizarUrl(u) {
        u = String(u || '').trim();
        if (!u) return '';
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        try {
            const url = new URL(u);
            if (!/\.html?$/i.test(url.pathname) && !url.pathname.endsWith('/')) url.pathname += '/';
            return url.href;
        } catch (e) { return ''; }
    }

    // El panel siempre vive en el sitio público (…/<id>/admin). El catálogo,
    // en el dominio propio si lo tiene; si no, en …/<id>.
    function urlPanel(t) { return T.urlPanelTienda(t.id); }
    function urlCatalogo(t) { return (t.meta && t.meta.url) || T.urlTienda(t.id); }
    const sinProtocolo = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

    function nombreTienda(id) {
        const t = datos.tiendas[id];
        if (!t) return id;
        return (t.identidad && t.identidad.nombreComercial) || (t.meta && t.meta.nombre) || id;
    }

    function nombreUsuario(u) { return (u && (u.nombre || u.email)) || 'Usuario'; }

    function copiar(texto) {
        const ok = () => toast('Copiado al portapapeles.');
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto).then(ok).catch(() => copiarViejo(texto, ok));
        copiarViejo(texto, ok);
    }
    function copiarViejo(texto, ok) {
        const ta = document.createElement('textarea');
        ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) { toast('No se pudo copiar: seleccioná el texto a mano.', 'error'); }
        ta.remove();
    }

    function cargando(btn, si, texto) {
        if (!btn) return;
        if (si) { btn.dataset.html = btn.innerHTML; btn.innerHTML = `<span class="spinner spinner-claro"></span>${esc(texto || 'Guardando…')}`; }
        else if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
        btn.disabled = si;
    }

    // Modal genérico: devuelve { el, cerrar }. data-cerrar cierra.
    function abrirModal({ titulo, icono, cuerpo, pie, ancha }) {
        const el = document.createElement('div');
        el.className = 'modal';
        el.innerHTML = `
            <form class="modal-caja${ancha ? ' ancha' : ''}" role="dialog" aria-modal="true" novalidate>
                <div class="modal-cabecera">
                    <h2><i class="fas ${icono || 'fa-pen'}"></i>${esc(titulo)}</h2>
                    <button type="button" class="btn btn-icono btn-texto" data-cerrar aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="modal-cuerpo">${cuerpo}</div>
                <div class="modal-pie">${pie || '<button type="button" class="btn" data-cerrar>Cerrar</button>'}</div>
            </form>`;
        document.body.appendChild(el);
        const alEscape = (e) => { if (e.key === 'Escape') cerrar(); };
        function cerrar() {
            document.removeEventListener('keydown', alEscape);
            el.classList.add('saliendo');
            setTimeout(() => el.remove(), 180);
        }
        document.addEventListener('keydown', alEscape);
        el.addEventListener('mousedown', e => { if (e.target === el) cerrar(); });
        el.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) cerrar(); });
        el.querySelectorAll('.ver-clave').forEach(b => b.addEventListener('click', () => {
            const i = el.querySelector('#' + b.dataset.para);
            i.type = i.type === 'password' ? 'text' : 'password';
        }));
        setTimeout(() => { const f = el.querySelector('input:not([disabled]):not([type="hidden"]), textarea'); if (f) f.focus(); }, 60);
        return { el, cerrar, q: (s) => el.querySelector(s), form: el.querySelector('form') };
    }

    function avisoModal(m, texto) {
        let p = m.q('.login-error');
        if (!p) { p = document.createElement('p'); p.className = 'login-error'; m.q('.modal-cuerpo').appendChild(p); }
        p.innerHTML = texto ? `<i class="fas fa-circle-exclamation"></i> ${texto}` : '';
        p.hidden = !texto;
        if (texto) p.scrollIntoView({ block: 'nearest' });
    }

    function checksTiendas(nombre, marcadas) {
        const ids = Object.keys(datos.tiendas).sort((a, b) => nombreTienda(a).localeCompare(nombreTienda(b)));
        if (!ids.length) return '<p class="ayuda">Todavía no hay tiendas. Podés asignarlas más tarde.</p>';
        return `<div class="checks-tiendas">${ids.map(id => `
            <label class="check"><input type="checkbox" name="${nombre}" value="${esc(id)}" ${marcadas && marcadas[id] ? 'checked' : ''}>
            <span>${esc(nombreTienda(id))} <span class="chip-tienda">${esc(id)}</span></span></label>`).join('')}</div>`;
    }

    function checksUsuarios(nombre, marcados) {
        const uids = Object.keys(datos.usuarios).sort((a, b) => nombreUsuario(datos.usuarios[a]).localeCompare(nombreUsuario(datos.usuarios[b])));
        if (!uids.length) return '<p class="ayuda">Todavía no hay usuarios cargados.</p>';
        return `<div class="checks-tiendas">${uids.map(uid => {
            const u = datos.usuarios[uid];
            return `<label class="check"><input type="checkbox" name="${nombre}" value="${esc(uid)}" ${marcados && marcados[uid] ? 'checked' : ''}>
                <span>${esc(nombreUsuario(u))}${u.activo === false ? ' <span class="pill mal">suspendido</span>' : ''}<br><small class="ayuda">${esc(u.email || '')}</small></span></label>`;
        }).join('')}</div>`;
    }

    const marcados = (m, nombre) => Array.from(m.el.querySelectorAll(`input[name="${nombre}"]:checked`)).map(i => i.value);

    function campoClaveGenerada(id) {
        return `<div class="campo"><label for="${id}">Contraseña temporal</label>
            <div class="clave-generada">
                <input type="text" id="${id}" value="${esc(window.TiendaAuth.generarClave())}" autocomplete="off" spellcheck="false">
                <button type="button" class="btn btn-icono" data-regenerar="${id}" title="Generar otra" aria-label="Generar otra"><i class="fas fa-shuffle"></i></button>
            </div>
            <small>Se genera sola. Podés cambiarla: mínimo 8 caracteres con letras y números.</small></div>`;
    }

    function activarRegenerar(m) {
        m.el.querySelectorAll('[data-regenerar]').forEach(b => b.addEventListener('click', () => {
            m.q('#' + b.dataset.regenerar).value = window.TiendaAuth.generarClave();
        }));
    }

    // ======================================================================
    // 2 · DATOS
    // ======================================================================
    const leer = (ruta) => db.ref(ruta).once('value').then(s => s.val());

    async function cargarTiendas() {
        const token = await firebase.auth().currentUser.getIdToken();
        const r = await fetch(`${T.baseDatosUrl()}/tiendas.json?shallow=true&auth=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!r.ok) throw Object.assign(new Error(r.status === 401 ? 'PERMISSION_DENIED' : 'HTTP ' + r.status), { code: r.status === 401 ? 'PERMISSION_DENIED' : undefined });
        const ids = Object.keys((await r.json()) || {});
        const nuevas = {};
        await Promise.all(ids.map(async id => {
            const base = 'tiendas/' + id + '/';
            const [meta, estado, admins, identidad, apariencia, actualizado, costo, baja, pideHP] = await Promise.all([
                leer(base + 'meta'), leer(base + 'estado'), leer(base + 'admins'),
                leer(base + 'config/identidad'), leer(base + 'config/apariencia'), leer(base + 'config/actualizado'), leer(base + 'costo'), leer(base + 'baja'),
                leer(base + 'interior/habilitado')
            ].map(p => p.catch(() => null)));
            nuevas[id] = { id, meta: meta || {}, estado: estado || { activa: true }, admins: admins || {}, identidad: identidad || {}, apariencia: apariencia || null, actualizado: actualizado || 0, costo: T.normalizarReglaCosto(costo), baja: baja || null, pideHP: pideHP === true };
        }));
        datos.tiendas = nuevas;
        datos.cargadas = true;
        renderTodo();
        cargarLogos();
        limpiarPedidosViejos(ids);
    }

    // Los pedidos de más de 90 días se borran solos (no hay Cloud Functions).
    // El panel de cada tienda ya lo hace al abrirse; acá se cubren las
    // tiendas cuyo dueño no entra seguido. No bloquea ni muestra nada.
    function limpiarPedidosViejos(ids) {
        const limite = T.limitePedidos();
        ids.forEach(id => {
            const ref = db.ref('tiendas/' + id + '/pedidos');
            ref.orderByChild('fecha').endAt(limite).once('value').then(s => {
                const borrar = {};
                s.forEach(c => { borrar[c.key] = null; });
                if (Object.keys(borrar).length) return ref.update(borrar);
            }).catch(e => console.warn('No se pudieron limpiar pedidos viejos de', id, e));
        });
    }

    function cargarLogos() {
        Object.values(datos.tiendas).forEach(t => {
            const id = t.identidad && t.identidad.logoClaro;
            if (!id || logos[t.id + ':' + id]) return;
            leer(`tiendas/${t.id}/assets/${id}/dataUrl`).then(url => {
                if (!url) return;
                logos[t.id + ':' + id] = url;
                const av = document.querySelector(`[data-avatar-tienda="${t.id}"]`);
                if (av) pintarAvatarTienda(av, t);
            }).catch(() => {});
        });
    }

    function escuchar() {
        db.ref('usuarios').on('value', s => { datos.usuarios = s.val() || {}; renderTodo(); }, error);
        db.ref('solicitudes').on('value', s => { datos.solicitudes = s.val() || {}; renderTodo(); }, error);
        db.ref('bajas').on('value', s => { datos.bajas = s.val() || {}; renderTodo(); }, error);
        db.ref('registros').on('value', s => { datos.registros = s.val() || {}; renderTodo(); }, error);
    }

    async function actualizar(cambios, msg) {
        await db.ref().update(cambios);
        if (msg) toast(msg);
        await cargarTiendas();
    }

    // Crea la cuenta en Authentication sin tocar la sesión actual
    async function crearCuenta(email, clave, nombre) {
        const app = firebase.initializeApp(firebaseConfig, 'altas-' + Date.now());
        try {
            const a = app.auth();
            await a.setPersistence(firebase.auth.Auth.Persistence.NONE);
            const cred = await a.createUserWithEmailAndPassword(email, clave);
            if (nombre) await cred.user.updateProfile({ displayName: nombre }).catch(() => {});
            const uid = cred.user.uid;
            await a.signOut();
            return uid;
        } finally {
            app.delete().catch(() => {});
        }
    }

    function errorDeAlta(e, email) {
        const pendiente = email && Object.values(datos.bajas).some(b => String(b.email || '').toLowerCase() === email);
        if (e && e.code === 'auth/email-already-in-use' && pendiente) {
            return 'Ese email es de un usuario que quitaste y cuya cuenta todavía no se borró (se borra sola cuando vuelve a entrar). Para usarlo ya, borrala en la consola de Firebase: <em>Authentication → Usuarios</em>, y volvé a intentar.';
        }
        if (e && e.code === 'auth/email-already-in-use') {
            return 'Ya existe una cuenta con ese email. Si esa persona ya tuvo acceso, pedile que entre al panel de su tienda y toque <strong>Solicitar acceso</strong>: la vas a ver en <em>Solicitudes</em> para aprobarla.';
        }
        return esc(window.TiendaAuth.mensajeDe(e));
    }

    function validarAlta(nombre, email, clave) {
        if (!EMAIL_VALIDO.test(email)) return 'Revisá el email.';
        return window.TiendaAuth.validarClave(clave);
    }

    // ======================================================================
    // 3 · RENDER
    // ======================================================================
    function renderTodo() {
        renderStats();
        renderActividad();
        renderTiendas();
        renderUsuarios();
        renderSolicitudes();
        avisarEstadisticas();
    }

    // Estadísticas (estadisticas.js) se carga recién al abrir su sección: lee
    // los pedidos de todas las tiendas y la hoja de productos.
    function avisarEstadisticas(recargar) {
        const sec = $('sec-estadisticas');
        if (!yo || !datos.cargadas || !sec || !sec.classList.contains('activa') || !window.GestionEstadisticas) return;
        window.GestionEstadisticas.activar({ db, tiendas: datos.tiendas, nombreTienda, recargar: !!recargar });
    }

    function stat(icono, etiqueta, valor, detalle) {
        return `<div class="stat"><div class="stat-etiqueta"><i class="fas ${icono}"></i>${etiqueta}</div>
            <div class="stat-valor">${valor}</div><div class="stat-detalle">${detalle}</div></div>`;
    }

    function renderStats() {
        const ts = Object.values(datos.tiendas);
        const us = Object.values(datos.usuarios);
        const pausadas = ts.filter(t => t.estado.activa === false).length;
        const suspendidos = us.filter(u => u.activo === false).length;
        const pendientes = us.filter(u => u.debeCambiarClave === true && u.activo !== false).length;
        const nSol = Object.keys(datos.solicitudes).length + ts.filter(t => t.baja).length + Object.keys(datos.registros).length;
        const ultima = ts.filter(t => t.actualizado).sort((a, b) => b.actualizado - a.actualizado)[0];
        $('stats').innerHTML =
            stat('fa-store', 'Tiendas', datos.cargadas ? ts.length : '–', `${ts.length - pausadas} activas · ${pausadas} pausadas`) +
            stat('fa-users', 'Usuarios', us.length, `${us.length - suspendidos} activos · ${suspendidos} suspendidos` + (pendientes ? ` · ${pendientes} sin estrenar` : '')) +
            stat('fa-inbox', 'Solicitudes', nSol, nSol ? 'esperando tu respuesta' : 'nada pendiente') +
            stat('fa-cloud-arrow-up', 'Última publicación', ultima ? esc(hace(ultima.actualizado)) : '–', ultima ? esc(nombreTienda(ultima.id)) : 'ninguna tienda publicó todavía');
        $('primerosPasos').hidden = !datos.cargadas || ts.length > 0;
        const nav = $('navSolicitudes');
        nav.textContent = nSol;
        nav.hidden = !nSol;
    }

    function renderActividad() {
        const ev = [];
        Object.values(datos.tiendas).forEach(t => {
            if (t.actualizado) ev.push({ ts: t.actualizado, i: 'fa-cloud-arrow-up', txt: `<strong>${esc(nombreTienda(t.id))}</strong> publicó cambios` });
            if (t.meta.creada) ev.push({ ts: t.meta.creada, i: 'fa-store', txt: `Se creó la tienda <strong>${esc(nombreTienda(t.id))}</strong>` });
        });
        Object.values(datos.usuarios).forEach(u => {
            if (u.ultimoIngreso) ev.push({ ts: u.ultimoIngreso, i: 'fa-right-to-bracket', txt: `<strong>${esc(nombreUsuario(u))}</strong> ingresó al panel` });
            if (u.creado) ev.push({ ts: u.creado, i: 'fa-user-plus', txt: `Alta de <strong>${esc(nombreUsuario(u))}</strong>` });
        });
        Object.values(datos.solicitudes).forEach(s => {
            if (s.fecha) ev.push({ ts: s.fecha, i: 'fa-inbox', txt: `<strong>${esc(s.email)}</strong> pidió acceso a ${esc(nombreTienda(s.tienda))}` });
        });
        ev.sort((a, b) => b.ts - a.ts);
        $('actividad').innerHTML = ev.length
            ? ev.slice(0, 12).map(e => `<li><i class="fas ${e.i}"></i><span>${e.txt}</span><time>${esc(hace(e.ts))}</time></li>`).join('')
            : '<li><span class="ayuda">Todavía no hay movimientos.</span></li>';
    }

    function pintarAvatarTienda(av, t) {
        const logo = t.identidad.logoClaro && logos[t.id + ':' + t.identidad.logoClaro];
        if (logo) {
            av.classList.add('con-imagen');
            av.style.backgroundImage = `url("${logo}")`;
        } else {
            av.style.backgroundColor = T.coloresDeTema(t.apariencia || undefined).primario;
        }
    }

    function filtra(texto, campos) {
        const q = slug(texto).replace(/-/g, ' ').trim();
        if (!q) return true;
        const heno = slug(campos.join(' ')).replace(/-/g, ' ');
        return q.split(' ').every(p => heno.includes(p));
    }

    function renderTiendas() {
        if (!datos.cargadas) return;
        const q = $('buscarTiendas').value;
        const lista = Object.values(datos.tiendas)
            .filter(t => filtra(q, [t.id, nombreTienda(t.id), t.meta.url || '', t.meta.notas || '']))
            .sort((a, b) => nombreTienda(a.id).localeCompare(nombreTienda(b.id)));
        if (!Object.keys(datos.tiendas).length) {
            $('listaTiendas').innerHTML = `<div class="vacio"><i class="fas fa-store"></i><p>Todavía no hay tiendas creadas.</p>
                <button type="button" class="btn btn-primario" data-accion="nueva-tienda"><i class="fas fa-plus"></i>Crear la primera</button></div>`;
            return;
        }
        if (!lista.length) { $('listaTiendas').innerHTML = '<div class="vacio"><i class="fas fa-magnifying-glass"></i><p>Ninguna tienda coincide con la búsqueda.</p></div>'; return; }
        $('listaTiendas').innerHTML = lista.map(t => {
            const pausada = t.estado.activa === false;
            const responsables = Object.keys(t.admins).filter(uid => t.admins[uid] === true);
            const chips = responsables.length
                ? responsables.map(uid => {
                    const u = datos.usuarios[uid];
                    return `<span class="pastilla" title="${esc(u ? u.email : uid)}">${esc(u ? nombreUsuario(u) : 'Cuenta sin registro')}${u && u.activo === false ? ' · suspendido' : ''}</span>`;
                }).join('')
                : '<span class="pill pausa">Sin responsable</span>';
            const url = urlCatalogo(t);
            return `
            <div class="fila-item${pausada ? ' apagada' : ''}">
                <div class="avatar" data-avatar-tienda="${esc(t.id)}">${esc(nombreTienda(t.id).charAt(0).toUpperCase())}</div>
                <div class="fila-principal">
                    <strong>${esc(nombreTienda(t.id))} ${pausada ? `<span class="pill pausa">${t.estado.pausadaPor === 'tienda' ? 'Pausada por la tienda' : 'Pausada'}</span>` : '<span class="pill ok">Activa</span>'}${t.baja ? ' <span class="pill mal" title="Su responsable pidió eliminarla">Pidió la baja</span>' : ''}</strong>
                    <span class="sub"><span class="chip-tienda">${esc(t.id)}</span> <a href="${esc(url)}" target="_blank" rel="noopener">${esc(sinProtocolo(url))}</a>${t.meta.url ? ' <span class="pill neutro" title="Dominio propio">dominio propio</span>' : ''}${t.costo.modo !== 'interior' ? ` <span class="pill neutro" title="Variable de costos">${esc(T.textoReglaCosto(t.costo))}</span>` : ''}${t.pideHP ? ' <span class="pill neutro" title="Puede solicitarte la mercadería de sus pedidos"><i class="fas fa-truck-ramp-box"></i> Pide a Home Point</span>' : ''}</span>
                </div>
                <div class="fila-meta">
                    <div class="chips">${chips}</div>
                    <span>${t.actualizado ? 'Publicada ' + esc(hace(t.actualizado)) : 'Sin publicar todavía'}</span>
                </div>
                <div class="fila-acciones">
                    <a class="btn btn-chico" href="${esc(urlPanel(t))}" target="_blank" rel="noopener"><i class="fas fa-sliders"></i>Panel</a>
                    <div class="menu-acciones">
                        <button type="button" class="btn btn-chico btn-icono" data-menu="tienda" data-id="${esc(t.id)}" aria-label="Más acciones" style="width:32px"><i class="fas fa-ellipsis"></i></button>
                    </div>
                </div>
            </div>`;
        }).join('');
        lista.forEach(t => { const av = document.querySelector(`[data-avatar-tienda="${t.id}"]`); if (av) pintarAvatarTienda(av, t); });
    }

    function renderUsuarios() {
        const q = $('buscarUsuarios').value;
        const uids = Object.keys(datos.usuarios)
            .filter(uid => {
                const u = datos.usuarios[uid];
                return filtra(q, [u.nombre || '', u.email || '', ...Object.keys(u.tiendas || {}).map(nombreTienda)]);
            })
            .sort((a, b) => nombreUsuario(datos.usuarios[a]).localeCompare(nombreUsuario(datos.usuarios[b])));
        if (!Object.keys(datos.usuarios).length) {
            $('listaUsuarios').innerHTML = `<div class="vacio"><i class="fas fa-users"></i><p>Todavía no hay usuarios. Creá uno nuevo o aprobá una solicitud.</p>
                <button type="button" class="btn btn-primario" data-accion="nuevo-usuario"><i class="fas fa-user-plus"></i>Nuevo usuario</button></div>` + htmlBajas();
            return;
        }
        if (!uids.length) { $('listaUsuarios').innerHTML = '<div class="vacio"><i class="fas fa-magnifying-glass"></i><p>Ningún usuario coincide con la búsqueda.</p></div>' + htmlBajas(); return; }
        $('listaUsuarios').innerHTML = uids.map(uid => {
            const u = datos.usuarios[uid];
            const suspendido = u.activo === false;
            const tiendas = Object.keys(u.tiendas || {});
            const pills = [
                suspendido ? '<span class="pill mal">Suspendido</span>' : '<span class="pill ok">Activo</span>',
                u.debeCambiarClave === true && !suspendido ? '<span class="pill neutro" title="Todavía no eligió su contraseña">Clave temporal</span>' : ''
            ].join(' ');
            return `
            <div class="fila-item${suspendido ? ' apagada' : ''}">
                <div class="avatar redondo">${esc(nombreUsuario(u).trim().charAt(0).toUpperCase())}</div>
                <div class="fila-principal">
                    <strong>${esc(nombreUsuario(u))} ${pills}</strong>
                    <span class="sub">${esc(u.email || uid)}</span>
                </div>
                <div class="fila-meta">
                    <div class="chips">${tiendas.length ? tiendas.map(id => `<span class="pastilla">${esc(nombreTienda(id))}</span>`).join('') : '<span class="pill pausa">Sin tiendas</span>'}</div>
                    <span>${u.ultimoIngreso ? 'Último ingreso ' + esc(hace(u.ultimoIngreso)) : 'Nunca ingresó'}</span>
                </div>
                <div class="fila-acciones">
                    <button type="button" class="btn btn-chico" data-accion="editar-usuario" data-id="${esc(uid)}"><i class="fas fa-pen"></i>Editar</button>
                    <div class="menu-acciones">
                        <button type="button" class="btn btn-chico btn-icono" data-menu="usuario" data-id="${esc(uid)}" aria-label="Más acciones" style="width:32px"><i class="fas fa-ellipsis"></i></button>
                    </div>
                </div>
            </div>`;
        }).join('') + htmlBajas();
    }

    // Cuentas quitadas que todavía existen en Authentication (se borran solas
    // cuando la persona vuelve a entrar).
    function htmlBajas() {
        const bajas = Object.values(datos.bajas).sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
        if (!bajas.length) return '';
        return `<p class="ayuda" style="margin:14px 4px 0"><i class="fas fa-user-clock"></i> Cuentas quitadas que esperan borrarse de Authentication (se borran solas la próxima vez que esa persona intente entrar):
            ${bajas.map(b => `<span class="pastilla" title="Quitada ${esc(hace(b.fecha))}">${esc(b.email || 'sin email')}</span>`).join(' ')}</p>`;
    }

    function renderBajasTiendas() {
        const lista = Object.values(datos.tiendas).filter(t => t.baja).sort((a, b) => (b.baja.fecha || 0) - (a.baja.fecha || 0));
        if (!lista.length) {
            $('listaBajasTiendas').innerHTML = '<div class="vacio"><i class="fas fa-store"></i><p>Ninguna tienda pidió ser eliminada.</p></div>';
            return;
        }
        $('listaBajasTiendas').innerHTML = lista.map(t => {
            const b = t.baja;
            const u = datos.usuarios[b.uid];
            return `
            <div class="fila-item">
                <div class="avatar" data-avatar-tienda="${esc(t.id)}">${esc(nombreTienda(t.id).charAt(0).toUpperCase())}</div>
                <div class="fila-principal">
                    <strong>${esc(nombreTienda(t.id))} ${b.borrarUsuario ? '<span class="pill mal">También su usuario</span>' : ''}</strong>
                    <span class="sub">Pedido por ${esc(u ? nombreUsuario(u) : (b.email || 'su responsable'))}${b.motivo ? ' · «' + esc(b.motivo) + '»' : ''}</span>
                </div>
                <div class="fila-meta">
                    <span class="chip-tienda">${esc(t.id)}</span>
                    <span>${esc(hace(b.fecha))}</span>
                </div>
                <div class="fila-acciones">
                    <button type="button" class="btn btn-chico btn-peligro" data-accion="eliminar-tienda" data-id="${esc(t.id)}"><i class="fas fa-trash"></i>Eliminar</button>
                    <button type="button" class="btn btn-chico" data-accion="rechazar-baja" data-id="${esc(t.id)}"><i class="fas fa-xmark"></i>Rechazar</button>
                </div>
            </div>`;
        }).join('');
        lista.forEach(t => { const av = $('listaBajasTiendas').querySelector(`[data-avatar-tienda="${t.id}"]`); if (av) pintarAvatarTienda(av, t); });
    }

    function renderRegistros() {
        $('enlaceRegistro').href = T.BASE_SITIO + 'registro';
        const uids = Object.keys(datos.registros).sort((a, b) => (datos.registros[b].fecha || 0) - (datos.registros[a].fecha || 0));
        if (!uids.length) {
            $('listaRegistros').innerHTML = '<div class="vacio"><i class="fas fa-store"></i><p>No hay tiendas nuevas para revisar. Compartí el formulario de registro para recibirlas acá.</p></div>';
            return;
        }
        $('listaRegistros').innerHTML = uids.map(uid => {
            const r = datos.registros[uid];
            const ocupada = !!datos.tiendas[r.tienda];
            const existente = datos.usuarios[uid];
            return `
            <div class="fila-item">
                <div class="avatar">${esc(String(r.tiendaNombre || r.tienda || '?').charAt(0).toUpperCase())}</div>
                <div class="fila-principal">
                    <strong>${esc(r.tiendaNombre)} ${ocupada ? '<span class="pill mal" title="Al aprobar, elegí otra dirección">ID en uso</span>' : ''}${existente ? ' <span class="pill neutro">Ya es usuario</span>' : ''}</strong>
                    <span class="sub"><span class="chip-tienda">${esc(r.tienda)}</span> ${esc(r.nombre)} · ${esc(r.email)}${r.comentario ? ' · «' + esc(r.comentario) + '»' : ''}</span>
                </div>
                <div class="fila-meta">
                    ${r.url ? `<span>${esc(sinProtocolo(r.url))}</span>` : ''}
                    <span>${esc(hace(r.fecha))}</span>
                </div>
                <div class="fila-acciones">
                    <button type="button" class="btn btn-chico btn-primario" data-accion="aprobar-registro" data-id="${esc(uid)}"><i class="fas fa-check"></i>Revisar</button>
                    <button type="button" class="btn btn-chico btn-peligro" data-accion="rechazar-registro" data-id="${esc(uid)}"><i class="fas fa-xmark"></i>Rechazar</button>
                </div>
            </div>`;
        }).join('');
    }

    function renderSolicitudes() {
        renderRegistros();
        renderBajasTiendas();
        const uids = Object.keys(datos.solicitudes).sort((a, b) => (datos.solicitudes[b].fecha || 0) - (datos.solicitudes[a].fecha || 0));
        if (!uids.length) {
            $('listaSolicitudes').innerHTML = '<div class="vacio"><i class="fas fa-inbox"></i><p>No hay solicitudes pendientes.</p></div>';
            return;
        }
        $('listaSolicitudes').innerHTML = uids.map(uid => {
            const s = datos.solicitudes[uid];
            const yaExiste = !!datos.usuarios[uid];
            return `
            <div class="fila-item">
                <div class="avatar redondo">${esc((s.nombre || s.email || '?').charAt(0).toUpperCase())}</div>
                <div class="fila-principal">
                    <strong>${esc(s.nombre || s.email)} ${yaExiste ? '<span class="pill neutro">Ya es usuario</span>' : ''}</strong>
                    <span class="sub">${esc(s.email)}</span>
                </div>
                <div class="fila-meta">
                    <span>Pide acceso a <strong>${esc(nombreTienda(s.tienda))}</strong> <span class="chip-tienda">${esc(s.tienda)}</span></span>
                    <span>${esc(hace(s.fecha))}</span>
                </div>
                <div class="fila-acciones">
                    <button type="button" class="btn btn-chico btn-primario" data-accion="aprobar" data-id="${esc(uid)}"><i class="fas fa-check"></i>Aprobar</button>
                    <button type="button" class="btn btn-chico btn-peligro" data-accion="rechazar" data-id="${esc(uid)}"><i class="fas fa-xmark"></i>Rechazar</button>
                </div>
            </div>`;
        }).join('');
    }

    // ======================================================================
    // 4 · MENÚS DE ACCIONES
    // ======================================================================
    function cerrarMenus() { document.querySelectorAll('.menu-lista').forEach(m => m.remove()); }

    // El menú se ubica junto al botón pero siempre dentro de la pantalla: en
    // celulares angostos se corre hacia adentro en vez de salirse por un
    // costado, y si no entra abajo se abre hacia arriba.
    function ubicarMenu(boton, m) {
        const g = 8;
        const vw = document.documentElement.clientWidth, vh = window.innerHeight;
        const r = boton.getBoundingClientRect();
        const w = m.offsetWidth, h = m.offsetHeight;
        const left = Math.max(g, Math.min(r.right - w, vw - g - w));
        let top = r.bottom + 6;
        if (top + h > vh - g && r.top - 6 - h >= g) top = r.top - 6 - h;
        m.style.left = left + 'px';
        m.style.top = Math.max(g, top) + 'px';
    }
    // Como queda fijo en la pantalla, se cierra al desplazar o girar el celular
    window.addEventListener('scroll', e => { if (!(e.target.closest && e.target.closest('.menu-lista'))) cerrarMenus(); }, { passive: true, capture: true });
    window.addEventListener('resize', cerrarMenus);

    function abrirMenu(boton) {
        const yaAbierto = boton.parentElement.querySelector('.menu-lista');
        cerrarMenus();
        if (yaAbierto) return;
        const id = boton.dataset.id;
        let html = '';
        if (boton.dataset.menu === 'tienda') {
            const t = datos.tiendas[id];
            const pausada = t.estado.activa === false;
            html = `
                <a href="${esc(urlCatalogo(t))}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i>Ver catálogo</a>
                <button type="button" data-accion="editar-tienda" data-id="${esc(id)}"><i class="fas fa-pen"></i>Editar datos y responsables</button>
                <button type="button" data-accion="variable-costos" data-id="${esc(id)}"><i class="fas fa-percent"></i>Variable de costos</button>
                <button type="button" data-accion="solicitar-hp" data-id="${esc(id)}"><i class="fas fa-truck-ramp-box"></i>${t.pideHP ? 'Deshabilitar' : 'Habilitar'} "Solicitar a Home Point"</button>
                <button type="button" data-accion="copiar-catalogo" data-id="${esc(id)}"><i class="fas fa-link"></i>Copiar enlace del catálogo</button>
                <button type="button" data-accion="copiar-panel" data-id="${esc(id)}"><i class="fas fa-sliders"></i>Copiar enlace del panel</button>
                <button type="button" data-accion="pagina-dominio" data-id="${esc(id)}"><i class="fas fa-globe"></i>Página para dominio propio</button>
                <hr>
                <button type="button" data-accion="${pausada ? 'reactivar' : 'pausar'}" data-id="${esc(id)}"><i class="fas ${pausada ? 'fa-play' : 'fa-pause'}"></i>${pausada ? 'Reactivar tienda' : 'Pausar tienda'}</button>
                <button type="button" class="peligro" data-accion="eliminar-tienda" data-id="${esc(id)}"><i class="fas fa-trash"></i>Eliminar tienda</button>`;
        } else {
            const u = datos.usuarios[id];
            const suspendido = u.activo === false;
            html = `
                <button type="button" data-accion="editar-usuario" data-id="${esc(id)}"><i class="fas fa-pen"></i>Editar nombre y tiendas</button>
                <button type="button" data-accion="restablecer" data-id="${esc(id)}"><i class="fas fa-envelope"></i>Enviar email para restablecer contraseña</button>
                <button type="button" data-accion="forzar-cambio" data-id="${esc(id)}"><i class="fas fa-key"></i>Pedir contraseña nueva al ingresar</button>
                <hr>
                <button type="button" data-accion="${suspendido ? 'reactivar-usuario' : 'suspender'}" data-id="${esc(id)}"><i class="fas ${suspendido ? 'fa-user-check' : 'fa-user-lock'}"></i>${suspendido ? 'Reactivar acceso' : 'Suspender acceso'}</button>
                <button type="button" class="peligro" data-accion="quitar-usuario" data-id="${esc(id)}"><i class="fas fa-user-xmark"></i>Quitar del sistema</button>`;
        }
        const m = document.createElement('div');
        m.className = 'menu-lista';
        m.setAttribute('role', 'menu');
        m.innerHTML = html;
        boton.parentElement.appendChild(m);
        ubicarMenu(boton, m);
    }

    // ======================================================================
    // 5 · ACCIONES · TIENDAS
    // ======================================================================
    function configInicial(nombre) {
        const c = T.normalizarConfig(null);
        c.identidad.nombreComercial = nombre;
        c.identidad.tituloPagina = nombre;
        const limpio = T.clonar(c);
        limpio.actualizado = TS();
        return limpio;
    }

    function modalNuevaTienda() {
        const hayUsuarios = Object.keys(datos.usuarios).length > 0;
        const m = abrirModal({
            titulo: 'Nueva tienda', icono: 'fa-store', ancha: true,
            cuerpo: `
                <div class="campos">
                    <div class="campo"><label for="ntNombre">Nombre comercial</label><input type="text" id="ntNombre" maxlength="60" placeholder="Ej.: Bazar Lucía" required></div>
                    <div class="campo"><label for="ntId">ID de la tienda</label><input type="text" id="ntId" maxlength="31" placeholder="bazar-lucia" spellcheck="false">
                        <small>Es la parte final del enlace. Minúsculas, números y guiones. No se cambia después.</small></div>
                    <div class="campo ancho"><label>Enlace del catálogo</label><div class="credenciales" id="ntEnlace" style="padding:10px 14px">${esc(T.urlTienda('…'))}</div></div>
                    <div class="campo ancho"><label for="ntUrl">Dominio propio <span style="text-transform:none;font-weight:500">(opcional)</span></label><input type="url" id="ntUrl" placeholder="https://bazarlucia.com.ar/">
                        <small>Sólo si la tienda va a tener su propio dominio (.com.ar, .com…). Se puede agregar después.</small></div>
                    <div class="campo ancho"><label for="ntNotas">Notas internas <span style="text-transform:none;font-weight:500">(sólo las ves vos)</span></label><textarea id="ntNotas" maxlength="500" rows="2" placeholder="Contacto, condiciones, vencimiento del hosting…" style="min-height:60px"></textarea></div>
                </div>
                <hr class="separador">
                <h3 class="modal-subtitulo" style="margin-bottom:10px">Responsable</h3>
                <div class="opciones-radio">
                    <label><input type="radio" name="ntResp" value="nuevo" checked>Crear usuario nuevo</label>
                    ${hayUsuarios ? '<label><input type="radio" name="ntResp" value="existente">Usuario existente</label>' : ''}
                    <label><input type="radio" name="ntResp" value="ninguno">Más tarde</label>
                </div>
                <div id="ntRespNuevo" class="campos" style="margin-top:14px">
                    <div class="campo"><label for="ntUNombre">Nombre</label><input type="text" id="ntUNombre" maxlength="80" placeholder="Lucía Pérez"></div>
                    <div class="campo"><label for="ntUEmail">Email</label><input type="email" id="ntUEmail" maxlength="200" placeholder="lucia@gmail.com"></div>
                    ${campoClaveGenerada('ntUClave')}
                    <div class="campo" style="justify-content:center"><label class="check"><input type="checkbox" id="ntUCambiar" checked><span>Pedir contraseña nueva en el primer ingreso</span></label></div>
                </div>
                <div id="ntRespExistente" style="margin-top:14px" hidden>${checksUsuarios('ntUsuarios', {})}</div>`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="ntCrear"><i class="fas fa-check"></i>Crear tienda</button>`
        });
        activarRegenerar(m);
        let idTocado = false;
        const pintarEnlace = () => { m.q('#ntEnlace').textContent = T.urlTienda(m.q('#ntId').value || '…'); };
        m.q('#ntNombre').addEventListener('input', () => { if (!idTocado) m.q('#ntId').value = slug(m.q('#ntNombre').value); pintarEnlace(); });
        m.q('#ntId').addEventListener('input', () => { idTocado = true; m.q('#ntId').value = m.q('#ntId').value.toLowerCase().replace(/[^a-z0-9-]/g, ''); pintarEnlace(); });
        m.el.querySelectorAll('input[name="ntResp"]').forEach(r => r.addEventListener('change', () => {
            const v = m.q('input[name="ntResp"]:checked').value;
            m.q('#ntRespNuevo').hidden = v !== 'nuevo';
            m.q('#ntRespExistente').hidden = v !== 'existente';
        }));

        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            avisoModal(m, '');
            const nombre = m.q('#ntNombre').value.trim();
            const id = m.q('#ntId').value.trim();
            const urlTxt = m.q('#ntUrl').value.trim();
            const url = normalizarUrl(urlTxt);
            const resp = m.q('input[name="ntResp"]:checked').value;
            if (!nombre) { avisoModal(m, 'Escribí el nombre comercial.'); m.q('#ntNombre').focus(); return; }
            if (T.IDS_RESERVADOS.includes(id)) { avisoModal(m, `<code>${esc(id)}</code> es una palabra reservada del sistema: elegí otro ID.`); m.q('#ntId').focus(); return; }
            if (!T.idValido(id)) { avisoModal(m, 'El ID tiene que tener entre 2 y 31 caracteres: minúsculas, números y guiones (sin empezar con guion).'); m.q('#ntId').focus(); return; }
            if (datos.tiendas[id]) { avisoModal(m, `Ya existe una tienda con el ID <code>${esc(id)}</code>.`); m.q('#ntId').focus(); return; }
            if (urlTxt && !url) { avisoModal(m, 'El dominio propio no es válido.'); m.q('#ntUrl').focus(); return; }
            let uNombre = '', uEmail = '', uClave = '';
            if (resp === 'nuevo') {
                uNombre = m.q('#ntUNombre').value.trim();
                uEmail = m.q('#ntUEmail').value.trim().toLowerCase();
                uClave = m.q('#ntUClave').value;
                const mal = validarAlta(uNombre, uEmail, uClave);
                if (mal) { avisoModal(m, esc(mal)); return; }
            }
            const existentes = resp === 'existente' ? marcados(m, 'ntUsuarios') : [];
            const cambiar = resp === 'nuevo' && m.q('#ntUCambiar').checked;

            cargando(m.q('#ntCrear'), true, 'Creando…');
            let uid = null;
            try {
                if (resp === 'nuevo') uid = await crearCuenta(uEmail, uClave, uNombre);
            } catch (err) {
                cargando(m.q('#ntCrear'), false);
                avisoModal(m, errorDeAlta(err, uEmail));
                return;
            }
            const c = {};
            c[`tiendas/${id}/meta`] = { nombre, url, notas: m.q('#ntNotas').value.trim(), creada: TS(), creadaPor: yo.uid };
            c[`tiendas/${id}/estado`] = { activa: true };
            c[`tiendas/${id}/config`] = configInicial(nombre);
            if (uid) {
                c[`tiendas/${id}/admins/${uid}`] = true;
                c[`usuarios/${uid}`] = { email: uEmail, nombre: uNombre, activo: true, debeCambiarClave: cambiar, creado: TS(), tiendas: { [id]: true } };
            }
            existentes.forEach(u => { c[`tiendas/${id}/admins/${u}`] = true; c[`usuarios/${u}/tiendas/${id}`] = true; });
            try {
                await actualizar(c);
            } catch (err) {
                cargando(m.q('#ntCrear'), false);
                avisoModal(m, esc(window.TiendaAuth.mensajeDe(err)) + (uid ? ` La cuenta de ${esc(uEmail)} sí se creó: asignala desde <em>Usuarios</em> o con una solicitud.` : ''));
                return;
            }
            m.cerrar();
            if (uid) mostrarCredenciales({ nombre: uNombre, email: uEmail, clave: uClave, tiendas: [id], cambiar, nuevaTienda: id });
            else mostrarTiendaCreada(id);
        });
    }

    function mostrarTiendaCreada(id) {
        const m = abrirModal({
            titulo: 'Tienda creada', icono: 'fa-circle-check',
            cuerpo: `<p><strong>${esc(nombreTienda(id))}</strong> ya está publicada. No hay que subir nada:</p>
                ${enlacesTienda(id)}`,
            pie: `<button type="button" class="btn btn-primario" data-cerrar>Listo</button>`
        });
        return m;
    }

    function enlacesTienda(id) {
        const t = datos.tiendas[id] || { id, meta: {} };
        const fila = (icono, etiqueta, url, accion) => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
                <i class="fas ${icono}" style="width:18px;color:var(--verde-600)"></i>
                <span style="flex:1;min-width:0"><small class="ayuda">${etiqueta}</small><br><a href="${esc(url)}" target="_blank" rel="noopener" style="word-break:break-all">${esc(sinProtocolo(url))}</a></span>
                <button type="button" class="btn btn-chico" data-accion="${accion}" data-id="${esc(id)}"><i class="fas fa-copy"></i>Copiar</button>
            </div>`;
        return fila('fa-store', 'Catálogo (para sus clientes)', urlCatalogo(t), 'copiar-catalogo') +
               fila('fa-sliders', 'Panel (para el vendedor)', urlPanel(t), 'copiar-panel');
    }

    function mostrarCredenciales({ nombre, email, clave, tiendas, cambiar, nuevaTienda }) {
        const t = datos.tiendas[tiendas[0]];
        const panel = t ? urlPanel(t) : T.BASE_SITIO + 'admin.html';
        const catalogo = t ? urlCatalogo(t) : '';
        const nombresT = tiendas.map(nombreTienda).join(', ');
        const texto = [
            `¡Hola${nombre ? ' ' + nombre.split(' ')[0] : ''}! Ya tenés acceso al panel de ${tiendas.length > 1 ? 'tus tiendas' : 'tu tienda'}${nombresT ? ' ' + nombresT : ''}.`,
            '',
            ...(catalogo ? [`Tu catálogo: ${catalogo}`] : []),
            `Panel: ${panel}`,
            `Usuario: ${email}`,
            `Contraseña${cambiar ? ' temporal' : ''}: ${clave}`,
            '',
            cambiar ? 'Al ingresar por primera vez te va a pedir que elijas una contraseña nueva.' : 'Podés cambiar la contraseña cuando quieras desde "Mi cuenta", arriba a la derecha.'
        ].join('\n');
        const m = abrirModal({
            titulo: 'Usuario creado', icono: 'fa-circle-check', ancha: true,
            cuerpo: `
                <div class="login-aviso"><i class="fas fa-triangle-exclamation"></i><span><strong>Copiá estos datos ahora:</strong> por seguridad la contraseña no se guarda y no se va a poder volver a ver. Si se pierde, mandale el email para restablecerla.</span></div>
                <pre class="credenciales" id="credTexto">${esc(texto)}</pre>
                ${nuevaTienda ? '<hr class="separador"><h3 class="modal-subtitulo">Enlaces de la tienda</h3>' + enlacesTienda(nuevaTienda) : ''}`,
            pie: `<a class="btn" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Acceso al panel de tu tienda')}&body=${encodeURIComponent(texto)}"><i class="fas fa-envelope"></i>Email</a>
                  <a class="btn" href="https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i>WhatsApp</a>
                  <button type="button" class="btn btn-primario" id="credCopiar"><i class="fas fa-copy"></i>Copiar</button>`
        });
        m.q('#credCopiar').addEventListener('click', () => copiar(texto));
    }

    // Variable de costos: de dónde sale el costo de los artículos de la tienda
    // (tiendas/<id>/costo; sin nodo = Descuento Interior). El vendedor no lo ve
    // ni lo puede cambiar.
    function modalVariableCostos(id) {
        const t = datos.tiendas[id];
        const opcion = (modo, titulo, detalle) => `
            <label class="check" style="align-items:flex-start;padding:10px 12px;border:1px solid var(--borde);border-radius:var(--radio-md)">
                <input type="radio" name="vcModo" value="${modo}" ${t.costo.modo === modo ? 'checked' : ''} style="margin-top:2px">
                <span><strong>${titulo}</strong>${detalle ? `<br><small class="ayuda" style="margin:0">${detalle}</small>` : ''}</span>
            </label>`;
        const m = abrirModal({
            titulo: 'Variable de costos', icono: 'fa-percent',
            cuerpo: `
                <p class="ayuda" style="margin-top:0">Costo de los artículos de <strong>${esc(nombreTienda(id))}</strong>. Sobre ese costo se aplican las escalas de ganancia del vendedor, y es el que queda en sus pedidos y facturación.</p>
                <div style="display:grid;gap:8px">
                    ${opcion('interior', 'Descuento Interior', 'Opción por defecto.')}
                    ${opcion('costo', 'Valor Costo', '')}
                    ${opcion('costoPct', 'Costo %', 'Valor Costo más un porcentaje (0 % = mismo Valor Costo).')}
                    ${opcion('lista', 'Precio de Lista', 'Columna G de la hoja.')}
                </div>
                <div class="campo" id="vcPctCampo" style="margin-top:12px" ${t.costo.modo === 'costoPct' ? '' : 'hidden'}>
                    <label for="vcPct">Porcentaje sobre el Valor Costo</label>
                    <div class="con-sufijo"><input type="number" id="vcPct" min="-90" max="500" step="0.5" value="${esc(t.costo.modo === 'costoPct' ? t.costo.pct : '')}" placeholder="0"><span>%</span></div>
                    <small id="vcEj"></small>
                </div>
                <p class="ayuda">Los catálogos que ya estén abiertos toman el cambio al recargar la página.</p>`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="vcGuardar"><i class="fas fa-check"></i>Guardar</button>`
        });
        const modo = () => m.q('input[name="vcModo"]:checked').value;
        const pintarEj = () => {
            const txt = m.q('#vcPct').value, pct = Number(txt);
            m.q('#vcEj').textContent = txt !== '' && isFinite(pct)
                ? `Ej.: un artículo con Valor Costo de $10.000 queda con costo ${T.formatearMonto(T.costoDeFila({ [T.COLUMNA_COSTO.H]: 10000 }, { modo: 'costoPct', pct }))}.`
                : '';
        };
        m.el.querySelectorAll('input[name="vcModo"]').forEach(r => r.addEventListener('change', () => {
            m.q('#vcPctCampo').hidden = modo() !== 'costoPct';
            if (modo() === 'costoPct') m.q('#vcPct').focus();
        }));
        m.q('#vcPct').addEventListener('input', pintarEj);
        pintarEj();

        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const md = modo();
            const txt = m.q('#vcPct').value.trim(), pct = txt === '' ? 0 : Number(txt);   // vacío = 0 %
            if (md === 'costoPct' && (!isFinite(pct) || pct < -90 || pct > 500)) {
                avisoModal(m, 'El porcentaje sobre el Valor Costo tiene que estar entre -90 y 500 (0 = sin recargo).'); m.q('#vcPct').focus(); return;
            }
            // Descuento Interior = sin nodo (lo mínimo en la base)
            const valor = md === 'interior' ? null : (md === 'costoPct' ? { modo: md, pct } : { modo: md });
            cargando(m.q('#vcGuardar'), true);
            try { await actualizar({ [`tiendas/${id}/costo`]: valor }, 'Variable de costos actualizada.'); m.cerrar(); }
            catch (err) { cargando(m.q('#vcGuardar'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    // Aprobar una tienda pedida desde registro.html: se crea igual que con
    // "Nueva tienda", con la cuenta que la persona ya creó (su contraseña).
    function modalAprobarRegistro(uid) {
        const r = datos.registros[uid];
        if (!r) return;
        const previo = datos.usuarios[uid];
        const m = abrirModal({
            titulo: 'Aprobar tienda nueva', icono: 'fa-store', ancha: true,
            cuerpo: `
                <p class="ayuda" style="margin-top:0">Pedida por <strong>${esc(r.nombre)}</strong> (${esc(r.email)}) ${esc(hace(r.fecha))}. Podés corregir los datos antes de aprobar.${previo ? ' Ya es usuario: la tienda se suma a las que administra.' : ''}</p>
                ${r.comentario ? `<div class="login-aviso"><i class="fas fa-comment"></i><span>${esc(r.comentario)}</span></div>` : ''}
                <div class="campos">
                    <div class="campo"><label for="arNombre">Nombre comercial</label><input type="text" id="arNombre" maxlength="60" value="${esc(r.tiendaNombre)}"></div>
                    <div class="campo"><label for="arId">ID de la tienda</label><input type="text" id="arId" maxlength="31" spellcheck="false" value="${esc(r.tienda)}">
                        <small id="arEnlace"></small></div>
                    <div class="campo ancho"><label for="arUrl">Dominio propio (opcional)</label><input type="url" id="arUrl" value="${esc(r.url || '')}" placeholder="https://bazarlucia.com.ar/"></div>
                    <div class="campo ancho"><label for="arNotas">Notas internas <span style="text-transform:none;font-weight:500">(sólo las ves vos)</span></label><textarea id="arNotas" maxlength="500" rows="2" style="min-height:60px">${esc(r.comentario || '')}</textarea></div>
                </div>`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="arOk"><i class="fas fa-check"></i>Aprobar y crear tienda</button>`
        });
        const pintar = () => {
            const id = m.q('#arId').value;
            m.q('#arEnlace').innerHTML = datos.tiendas[id] ? '<span style="color:var(--rojo)">Ya existe una tienda con ese ID.</span>' : esc(sinProtocolo(T.urlTienda(id || '…')));
        };
        m.q('#arId').addEventListener('input', () => { m.q('#arId').value = m.q('#arId').value.toLowerCase().replace(/[^a-z0-9-]/g, ''); pintar(); });
        pintar();

        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = m.q('#arNombre').value.trim();
            const id = m.q('#arId').value.trim();
            const urlTxt = m.q('#arUrl').value.trim();
            const url = normalizarUrl(urlTxt);
            if (!nombre) { avisoModal(m, 'Escribí el nombre comercial.'); return; }
            if (T.IDS_RESERVADOS.includes(id)) { avisoModal(m, `<code>${esc(id)}</code> es una palabra reservada: elegí otro ID.`); return; }
            if (!T.idValido(id)) { avisoModal(m, 'El ID tiene que tener entre 2 y 31 caracteres: minúsculas, números y guiones.'); return; }
            if (datos.tiendas[id]) { avisoModal(m, `Ya existe una tienda con el ID <code>${esc(id)}</code>: elegí otro.`); return; }
            if (urlTxt && !url) { avisoModal(m, 'El dominio propio no es válido.'); return; }
            const c = {
                [`tiendas/${id}/meta`]: { nombre, url, notas: m.q('#arNotas').value.trim(), creada: TS(), creadaPor: yo.uid },
                [`tiendas/${id}/estado`]: { activa: true },
                [`tiendas/${id}/config`]: configInicial(nombre),
                [`tiendas/${id}/admins/${uid}`]: true,
                [`registros/${uid}`]: null,
                [`solicitudes/${uid}`]: null,
                [`bajas/${uid}`]: null
            };
            if (previo) {
                c[`usuarios/${uid}/tiendas/${id}`] = true;
                c[`usuarios/${uid}/activo`] = true;
            } else {
                c[`usuarios/${uid}`] = { email: r.email, nombre: r.nombre, activo: true, debeCambiarClave: false, creado: TS(), tiendas: { [id]: true } };
            }
            cargando(m.q('#arOk'), true, 'Creando…');
            try {
                await actualizar(c);
                m.cerrar();
                mostrarBienvenida(r, id);
            } catch (err) { cargando(m.q('#arOk'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    // Mensaje para avisarle que ya puede entrar (no hay envío automático de emails)
    function mostrarBienvenida(r, id) {
        const t = datos.tiendas[id] || { id, meta: {} };
        const texto = [
            `¡Hola ${String(r.nombre || '').split(' ')[0]}! Tu tienda ${nombreTienda(id)} ya está habilitada.`,
            '',
            `Tu catálogo: ${urlCatalogo(t)}`,
            `Panel: ${urlPanel(t)}`,
            `Usuario: ${r.email}`,
            'Contraseña: la que elegiste al registrarte.',
            '',
            'Entrá al panel para cargar tu logo, tus colores, tus contactos y tus precios.'
        ].join('\n');
        const m = abrirModal({
            titulo: 'Tienda aprobada', icono: 'fa-circle-check', ancha: true,
            cuerpo: `<p><strong>${esc(nombreTienda(id))}</strong> ya está creada. Avisale a ${esc(r.nombre)} que puede entrar:</p>
                <pre class="credenciales">${esc(texto)}</pre>
                <hr class="separador"><h3 class="modal-subtitulo">Enlaces de la tienda</h3>${enlacesTienda(id)}`,
            pie: `<a class="btn" href="mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent('Tu tienda ya está habilitada')}&body=${encodeURIComponent(texto)}"><i class="fas fa-envelope"></i>Email</a>
                  <a class="btn" href="https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i>WhatsApp</a>
                  <button type="button" class="btn btn-primario" id="bvCopiar"><i class="fas fa-copy"></i>Copiar</button>`
        });
        m.q('#bvCopiar').addEventListener('click', () => copiar(texto));
    }

    // Rechazar: se borra la solicitud. Si la cuenta se creó sólo para esto,
    // queda marcada en bajas/<uid> y se borra sola cuando vuelva a entrar.
    async function rechazarRegistro(uid) {
        const r = datos.registros[uid];
        if (!r) return;
        if (!confirm(`¿Rechazar la tienda "${r.tiendaNombre}" de ${r.nombre}?`)) return;
        const c = { [`registros/${uid}`]: null };
        if (!datos.usuarios[uid]) c[`bajas/${uid}`] = { email: String(r.email || '').slice(0, 200), fecha: TS() };
        try { await actualizar(c, 'Solicitud rechazada.'); } catch (err) { error(err); }
    }

    function modalEditarTienda(id) {
        const t = datos.tiendas[id];
        const m = abrirModal({
            titulo: 'Editar tienda', icono: 'fa-store', ancha: true,
            cuerpo: `
                <p class="ayuda" style="margin-top:0">ID <span class="chip-tienda">${esc(id)}</span> · El nombre visible, el logo y los colores los edita el responsable desde su panel.</p>
                <div class="campos">
                    <div class="campo"><label for="etNombre">Nombre interno</label><input type="text" id="etNombre" maxlength="60" value="${esc(t.meta.nombre || nombreTienda(id))}"></div>
                    <div class="campo"><label for="etUrl">Dominio propio (opcional)</label><input type="url" id="etUrl" value="${esc(t.meta.url || '')}" placeholder="https://bazarlucia.com.ar/"><small>Vacío: usa ${esc(sinProtocolo(T.urlTienda(id)))}</small></div>
                    <div class="campo ancho"><label for="etNotas">Notas internas</label><textarea id="etNotas" maxlength="500" rows="2" style="min-height:60px">${esc(t.meta.notas || '')}</textarea></div>
                </div>
                <hr class="separador">
                <h3 class="modal-subtitulo" style="margin-bottom:10px">Responsables</h3>
                ${checksUsuarios('etUsuarios', t.admins)}`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="etGuardar"><i class="fas fa-check"></i>Guardar</button>`
        });
        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const urlTxt = m.q('#etUrl').value.trim();
            const url = normalizarUrl(urlTxt);
            if (urlTxt && !url) { avisoModal(m, 'El dominio propio no es válido.'); return; }
            const c = {
                [`tiendas/${id}/meta/nombre`]: m.q('#etNombre').value.trim(),
                [`tiendas/${id}/meta/url`]: url,
                [`tiendas/${id}/meta/notas`]: m.q('#etNotas').value.trim()
            };
            const elegidos = new Set(marcados(m, 'etUsuarios'));
            Object.keys(datos.usuarios).forEach(uid => {
                const tenia = t.admins[uid] === true;
                if (elegidos.has(uid) && !tenia) { c[`tiendas/${id}/admins/${uid}`] = true; c[`usuarios/${uid}/tiendas/${id}`] = true; }
                if (!elegidos.has(uid) && tenia) { c[`tiendas/${id}/admins/${uid}`] = null; c[`usuarios/${uid}/tiendas/${id}`] = null; }
            });
            cargando(m.q('#etGuardar'), true);
            try { await actualizar(c, 'Tienda actualizada.'); m.cerrar(); }
            catch (err) { cargando(m.q('#etGuardar'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    function modalPausar(id) {
        const m = abrirModal({
            titulo: 'Pausar tienda', icono: 'fa-pause',
            cuerpo: `<p>Los clientes de <strong>${esc(nombreTienda(id))}</strong> van a ver un aviso de "no disponible" en lugar del catálogo. El responsable puede seguir entrando a su panel.</p>
                <div class="campo"><label for="paMensaje">Mensaje para los clientes (opcional)</label>
                <textarea id="paMensaje" maxlength="400" rows="3" placeholder="Estamos renovando el catálogo. ¡Volvemos pronto!"></textarea></div>`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="paOk"><i class="fas fa-pause"></i>Pausar</button>`
        });
        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            cargando(m.q('#paOk'), true);
            try {
                await actualizar({ [`tiendas/${id}/estado`]: { activa: false, mensaje: m.q('#paMensaje').value.trim(), desde: TS(), pausadaPor: 'admin' } }, 'Tienda pausada.');
                m.cerrar();
            } catch (err) { cargando(m.q('#paOk'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    function modalEliminarTienda(id) {
        const t = datos.tiendas[id];
        const m = abrirModal({
            titulo: 'Eliminar tienda', icono: 'fa-trash',
            cuerpo: `<p>Se borra <strong>toda</strong> la configuración de <strong>${esc(nombreTienda(id))}</strong>: textos, logos, banners, escalas, pedidos y responsables. No se puede deshacer.</p>
                ${t.baja ? `<p class="ayuda">Su responsable pidió la eliminación ${esc(hace(t.baja.fecha))}${t.baja.motivo ? ': «' + esc(t.baja.motivo) + '»' : ''}.</p>` : '<p class="ayuda">Si sólo querés que deje de verse, usá <strong>Pausar</strong>.</p>'}
                ${t.baja && t.baja.borrarUsuario ? (() => {
                    const u = datos.usuarios[t.baja.uid];
                    const otras = u ? Object.keys(u.tiendas || {}).filter(x => x !== id) : [];
                    return `<label class="check" style="margin:0 0 12px"><input type="checkbox" id="elUsuario" checked><span>También quitar del sistema a <strong>${esc(u ? nombreUsuario(u) : (t.baja.email || 'su usuario'))}</strong>, como pidió (sus datos se borran y su cuenta se elimina cuando vuelva a entrar)${otras.length ? `. <strong>Ojo:</strong> también administra ${otras.map(x => esc(nombreTienda(x))).join(', ')} y pierde ese acceso` : ''}.</span></label>`;
                })() : ''}
                <div class="campo"><label for="elId">Escribí <code>${esc(id)}</code> para confirmar</label><input type="text" id="elId" autocomplete="off" spellcheck="false"></div>`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="elOk" style="background:var(--rojo);border-color:var(--rojo)"><i class="fas fa-trash"></i>Eliminar</button>`
        });
        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (m.q('#elId').value.trim() !== id) { avisoModal(m, 'El ID no coincide.'); return; }
            let c = {};
            if (t.baja && t.baja.borrarUsuario && m.q('#elUsuario') && m.q('#elUsuario').checked) c = cambiosQuitarUsuario(t.baja.uid, t.baja.email);
            Object.keys(t.admins).forEach(uid => { if (datos.usuarios[uid] && c[`usuarios/${uid}`] !== null) c[`usuarios/${uid}/tiendas/${id}`] = null; });
            // La tienda entera (incluye admins, baja y pedidos); sus rutas internas no se repiten
            Object.keys(c).forEach(k => { if (k.indexOf(`tiendas/${id}/`) === 0) delete c[k]; });
            c[`tiendas/${id}`] = null;
            cargando(m.q('#elOk'), true, 'Eliminando…');
            try { await actualizar(c, 'Tienda eliminada.'); m.cerrar(); }
            catch (err) { cargando(m.q('#elOk'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    // Dominio propio: una única página (index.html) que se sube al hosting del
    // dominio. Trae el catálogo del sitio público y lo muestra con la
    // dirección del dominio propio, así siempre está actualizado.
    function paginaDominioPropio(id) {
        const t = datos.tiendas[id];
        const base = T.BASE_SITIO;
        const titulo = nombreTienda(id);
        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titulo)}</title>
<style>html,body{margin:0;height:100%;background:#f4f5f7}@media(prefers-color-scheme:dark){html,body{background:#0c0d0f}}</style>
</head>
<body>
<script>
/* Catálogo de "${esc(titulo)}". No editar: todo se configura desde el panel. */
(function () {
    var SITIO = ${JSON.stringify(base)}, TIENDA = ${JSON.stringify(id)};
    fetch(SITIO + 'index.html', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (html) {
            html = html.replace(/<head>/i, '<head><base href="' + SITIO + '"><script>window.__TIENDA_ID_FORZADA = "' + TIENDA + '";<\\/script>');
            document.open(); document.write(html); document.close();
        })
        .catch(function () { location.replace(SITIO + TIENDA); });
})();
<\/script>
</body>
</html>
`;
    }

    function modalDominioPropio(id) {
        const t = datos.tiendas[id];
        const html = paginaDominioPropio(id);
        const m = abrirModal({
            titulo: 'Dominio propio', icono: 'fa-globe', ancha: true,
            cuerpo: `
                <p>Para que <strong>${esc(nombreTienda(id))}</strong> se vea en un dominio propio (por ejemplo <code>bazarlucia.com.ar</code>):</p>
                <ol class="ayuda" style="font-size:.86rem;line-height:1.85;padding-left:20px;color:var(--tinta-700)">
                    <li>Descargá la página de abajo. Es un único archivo, <code>index.html</code>.</li>
                    <li>Subilo a la raíz del hosting de ese dominio. Sirve cualquier hosting, incluso uno gratuito como Netlify Drop o un repositorio nuevo de GitHub Pages con ese dominio.</li>
                    <li>En <em>Google Cloud → Credenciales → la API key de la hoja</em>, sumá <code>https://${esc(t && t.meta.url ? sinProtocolo(t.meta.url) : 'su-dominio.com.ar')}/*</code>.</li>
                    <li>Cargá el dominio en <em>Editar datos</em> de esta tienda, así los enlaces del panel lo usan.</li>
                </ol>
                <p class="ayuda">La página trae siempre el catálogo actualizado desde ${esc(sinProtocolo(T.BASE_SITIO))}: no hay que volver a subirla cuando hagas mejoras. El panel del vendedor sigue en ${esc(sinProtocolo(urlPanel(t)))}.</p>`,
            pie: `<button type="button" class="btn" data-cerrar>Cerrar</button>
                  <button type="button" class="btn btn-primario" id="dpDescargar"><i class="fas fa-file-arrow-down"></i>Descargar index.html</button>`
        });
        m.q('#dpDescargar').addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            a.download = 'index.html';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            toast('index.html descargado.');
        });
    }

    // ======================================================================
    // 6 · ACCIONES · USUARIOS
    // ======================================================================
    function modalNuevoUsuario() {
        const m = abrirModal({
            titulo: 'Nuevo usuario', icono: 'fa-user-plus', ancha: true,
            cuerpo: `
                <div class="campos">
                    <div class="campo"><label for="nuNombre">Nombre</label><input type="text" id="nuNombre" maxlength="80" placeholder="Lucía Pérez"></div>
                    <div class="campo"><label for="nuEmail">Email</label><input type="email" id="nuEmail" maxlength="200" placeholder="lucia@gmail.com"></div>
                    ${campoClaveGenerada('nuClave')}
                    <div class="campo" style="justify-content:center"><label class="check"><input type="checkbox" id="nuCambiar" checked><span>Pedir contraseña nueva en el primer ingreso</span></label></div>
                </div>
                <hr class="separador">
                <h3 class="modal-subtitulo" style="margin-bottom:10px">Tiendas que administra</h3>
                ${checksTiendas('nuTiendas', {})}`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="nuCrear"><i class="fas fa-check"></i>Crear usuario</button>`
        });
        activarRegenerar(m);
        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            avisoModal(m, '');
            const nombre = m.q('#nuNombre').value.trim();
            const email = m.q('#nuEmail').value.trim().toLowerCase();
            const clave = m.q('#nuClave').value;
            const cambiar = m.q('#nuCambiar').checked;
            const tiendas = marcados(m, 'nuTiendas');
            const mal = validarAlta(nombre, email, clave);
            if (mal) { avisoModal(m, esc(mal)); return; }
            if (Object.values(datos.usuarios).some(u => (u.email || '').toLowerCase() === email)) { avisoModal(m, 'Ese email ya está cargado como usuario.'); return; }
            cargando(m.q('#nuCrear'), true, 'Creando…');
            let uid;
            try { uid = await crearCuenta(email, clave, nombre); }
            catch (err) { cargando(m.q('#nuCrear'), false); avisoModal(m, errorDeAlta(err, email)); return; }
            const c = { [`usuarios/${uid}`]: { email, nombre, activo: true, debeCambiarClave: cambiar, creado: TS(), tiendas: Object.fromEntries(tiendas.map(t => [t, true])) } };
            tiendas.forEach(t => { c[`tiendas/${t}/admins/${uid}`] = true; });
            try { await actualizar(c); }
            catch (err) {
                cargando(m.q('#nuCrear'), false);
                avisoModal(m, esc(window.TiendaAuth.mensajeDe(err)) + ` La cuenta de ${esc(email)} sí se creó en Authentication.`);
                return;
            }
            m.cerrar();
            mostrarCredenciales({ nombre, email, clave, tiendas, cambiar });
        });
    }

    function modalEditarUsuario(uid) {
        const u = datos.usuarios[uid];
        const m = abrirModal({
            titulo: 'Editar usuario', icono: 'fa-user-pen', ancha: true,
            cuerpo: `
                <div class="campos">
                    <div class="campo"><label for="euNombre">Nombre</label><input type="text" id="euNombre" maxlength="80" value="${esc(u.nombre || '')}"></div>
                    <div class="campo"><label>Email</label><input type="email" value="${esc(u.email || '')}" disabled><small>El email es el usuario de ingreso y no se cambia desde acá.</small></div>
                </div>
                <hr class="separador">
                <h3 class="modal-subtitulo" style="margin-bottom:10px">Tiendas que administra</h3>
                ${checksTiendas('euTiendas', u.tiendas || {})}`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="euGuardar"><i class="fas fa-check"></i>Guardar</button>`
        });
        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const c = { [`usuarios/${uid}/nombre`]: m.q('#euNombre').value.trim() };
            const elegidas = new Set(marcados(m, 'euTiendas'));
            const tenia = u.tiendas || {};
            Object.keys(datos.tiendas).forEach(t => {
                if (elegidas.has(t) && !tenia[t]) { c[`usuarios/${uid}/tiendas/${t}`] = true; c[`tiendas/${t}/admins/${uid}`] = true; }
                if (!elegidas.has(t) && tenia[t]) { c[`usuarios/${uid}/tiendas/${t}`] = null; c[`tiendas/${t}/admins/${uid}`] = null; }
            });
            cargando(m.q('#euGuardar'), true);
            try { await actualizar(c, 'Usuario actualizado.'); m.cerrar(); }
            catch (err) { cargando(m.q('#euGuardar'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    async function restablecer(uid) {
        const u = datos.usuarios[uid];
        if (!u.email) return;
        if (!confirm(`¿Enviar a ${u.email} un email para que elija una contraseña nueva?`)) return;
        try {
            await firebase.auth().sendPasswordResetEmail(u.email);
            toast('Email enviado. Que revise también la carpeta de spam.');
        } catch (e) { error(e); }
    }

    async function forzarCambio(uid) {
        try {
            await db.ref(`usuarios/${uid}/debeCambiarClave`).set(true);
            toast('En su próximo ingreso va a tener que elegir una contraseña nueva.');
        } catch (e) { error(e); }
    }

    async function suspender(uid, activo) {
        const u = datos.usuarios[uid];
        if (!activo && !confirm(`¿Suspender el acceso de ${nombreUsuario(u)}? No va a poder guardar cambios en ninguna tienda hasta que lo reactives. Sus tiendas siguen visibles.`)) return;
        try {
            await db.ref(`usuarios/${uid}/activo`).set(activo);
            toast(activo ? 'Acceso reactivado.' : 'Acceso suspendido.');
            renderTiendas();
        } catch (e) { error(e); }
    }

    // Quitar del sistema: sin permisos en ninguna tienda y marca en bajas/<uid>
    // (la cuenta se borra de Authentication cuando vuelve a entrar).
    function cambiosQuitarUsuario(uid, emailRespaldo) {
        const u = datos.usuarios[uid] || {};
        const c = { [`usuarios/${uid}`]: null, [`bajas/${uid}`]: { email: String(u.email || emailRespaldo || '').slice(0, 200), fecha: TS() } };
        Object.keys(u.tiendas || {}).forEach(t => { if (datos.tiendas[t]) c[`tiendas/${t}/admins/${uid}`] = null; });
        Object.values(datos.tiendas).forEach(t => { if (t.admins[uid]) c[`tiendas/${t.id}/admins/${uid}`] = null; });
        return c;
    }

    function modalQuitarUsuario(uid) {
        const u = datos.usuarios[uid];
        const m = abrirModal({
            titulo: 'Quitar usuario', icono: 'fa-user-xmark',
            cuerpo: `<p><strong>${esc(nombreUsuario(u))}</strong> (${esc(u.email || '')}) pierde el acceso a todas sus tiendas y desaparece de esta lista. Las tiendas no se borran.</p>
                <p class="ayuda">La cuenta de ingreso se borra sola de Firebase Authentication la próxima vez que esa persona intente entrar. Hasta entonces queda sin ningún permiso. Si necesitás borrarla ya: consola de Firebase → Authentication → Usuarios.</p>`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="quOk" style="background:var(--rojo);border-color:var(--rojo)"><i class="fas fa-user-xmark"></i>Quitar</button>`
        });
        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const c = cambiosQuitarUsuario(uid);
            cargando(m.q('#quOk'), true, 'Quitando…');
            try { await actualizar(c, 'Usuario quitado.'); m.cerrar(); }
            catch (err) { cargando(m.q('#quOk'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    // ======================================================================
    // 7 · ACCIONES · SOLICITUDES
    // ======================================================================
    function modalAprobar(uid) {
        const s = datos.solicitudes[uid];
        const previo = datos.usuarios[uid];
        const marcadas = Object.assign({}, (previo && previo.tiendas) || {});
        if (s.tienda && datos.tiendas[s.tienda]) marcadas[s.tienda] = true;
        const m = abrirModal({
            titulo: 'Aprobar acceso', icono: 'fa-user-check', ancha: true,
            cuerpo: `
                <p><strong>${esc(s.email)}</strong> pidió administrar <strong>${esc(nombreTienda(s.tienda))}</strong>${datos.tiendas[s.tienda] ? '' : ' <span class="pill mal">esa tienda no existe</span>'}.</p>
                <div class="campos una"><div class="campo"><label for="apNombre">Nombre</label><input type="text" id="apNombre" maxlength="80" value="${esc((previo && previo.nombre) || s.nombre || '')}"></div></div>
                <hr class="separador">
                <h3 class="modal-subtitulo" style="margin-bottom:10px">Tiendas que administra</h3>
                ${checksTiendas('apTiendas', marcadas)}`,
            pie: `<button type="button" class="btn" data-cerrar>Cancelar</button>
                  <button type="submit" class="btn btn-primario" id="apOk"><i class="fas fa-check"></i>Aprobar</button>`
        });
        m.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tiendas = marcados(m, 'apTiendas');
            if (!tiendas.length) { avisoModal(m, 'Elegí al menos una tienda.'); return; }
            const c = {
                [`solicitudes/${uid}`]: null,
                [`bajas/${uid}`]: null,
                [`usuarios/${uid}/email`]: (previo && previo.email) || s.email,
                [`usuarios/${uid}/nombre`]: m.q('#apNombre').value.trim(),
                [`usuarios/${uid}/activo`]: true
            };
            if (!previo) { c[`usuarios/${uid}/creado`] = TS(); c[`usuarios/${uid}/debeCambiarClave`] = false; }
            tiendas.forEach(t => { c[`usuarios/${uid}/tiendas/${t}`] = true; c[`tiendas/${t}/admins/${uid}`] = true; });
            cargando(m.q('#apOk'), true);
            try { await actualizar(c, 'Acceso aprobado. Ya puede recargar su panel.'); m.cerrar(); }
            catch (err) { cargando(m.q('#apOk'), false); avisoModal(m, esc(window.TiendaAuth.mensajeDe(err))); }
        });
    }

    async function rechazar(uid) {
        const s = datos.solicitudes[uid];
        if (!confirm(`¿Rechazar la solicitud de ${s.email}?`)) return;
        try { await db.ref('solicitudes/' + uid).remove(); toast('Solicitud rechazada.'); }
        catch (e) { error(e); }
    }

    // ======================================================================
    // 8 · NAVEGACIÓN Y EVENTOS
    // ======================================================================
    function irA(seccion) {
        if (!$('sec-' + seccion)) seccion = 'resumen';
        document.querySelectorAll('.seccion').forEach(s => s.classList.toggle('activa', s.id === 'sec-' + seccion));
        document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('activo', b.dataset.ir === seccion));
        if (location.hash !== '#' + seccion) history.replaceState(null, '', '#' + seccion);
        avisarEstadisticas();
    }

    document.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-ir]');
        if (nav) { irA(nav.dataset.ir); return; }
        const menu = e.target.closest('[data-menu]');
        if (menu) { abrirMenu(menu); return; }
        const b = e.target.closest('[data-accion]');
        if (!e.target.closest('.menu-lista') || b) cerrarMenus();
        if (!b || !yo) return;
        const id = b.dataset.id;
        switch (b.dataset.accion) {
            case 'nueva-tienda': modalNuevaTienda(); break;
            case 'editar-tienda': modalEditarTienda(id); break;
            case 'variable-costos': modalVariableCostos(id); break;
            // Botón "Solicitar a Home Point" del panel del vendedor. Sin nodo =
            // deshabilitado. Al deshabilitar se conserva interior/pedido.
            case 'solicitar-hp': {
                const si = !datos.tiendas[id].pideHP;
                actualizar({ [`tiendas/${id}/interior/habilitado`]: si || null },
                    si ? `${nombreTienda(id)} ya puede solicitarte la mercadería de sus pedidos.` : `${nombreTienda(id)} ya no puede solicitarte mercadería.`).catch(error);
                break;
            }
            case 'pagina-dominio': modalDominioPropio(id); break;
            case 'copiar-catalogo': copiar(urlCatalogo(datos.tiendas[id])); break;
            case 'copiar-panel': copiar(urlPanel(datos.tiendas[id])); break;
            case 'pausar': modalPausar(id); break;
            case 'reactivar': actualizar({ [`tiendas/${id}/estado`]: { activa: true } }, 'Tienda reactivada.').catch(error); break;
            case 'eliminar-tienda': modalEliminarTienda(id); break;
            case 'nuevo-usuario': modalNuevoUsuario(); break;
            case 'editar-usuario': modalEditarUsuario(id); break;
            case 'restablecer': restablecer(id); break;
            case 'forzar-cambio': forzarCambio(id); break;
            case 'suspender': suspender(id, false); break;
            case 'reactivar-usuario': suspender(id, true); break;
            case 'quitar-usuario': modalQuitarUsuario(id); break;
            case 'aprobar': modalAprobar(id); break;
            case 'rechazar': rechazar(id); break;
            case 'aprobar-registro': modalAprobarRegistro(id); break;
            case 'rechazar-registro': rechazarRegistro(id); break;
            case 'copiar-registro': copiar(T.BASE_SITIO + 'registro'); break;
            case 'rechazar-baja':
                if (confirm(`¿Rechazar el pedido de eliminación de ${nombreTienda(id)}? La tienda sigue funcionando y su responsable puede volver a pedirlo.`)) {
                    actualizar({ [`tiendas/${id}/baja`]: null }, 'Pedido de eliminación rechazado.').catch(error);
                }
                break;
        }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenus(); });
    $('buscarTiendas').addEventListener('input', renderTiendas);
    $('buscarUsuarios').addEventListener('input', renderUsuarios);
    $('btnRecargar').addEventListener('click', () => {
        if (!yo) return;
        cargarTiendas().then(() => { avisarEstadisticas(true); toast('Datos actualizados.'); }).catch(error);
    });

    function iconoTema() {
        const oscuro = document.documentElement.getAttribute('data-theme') === 'dark';
        $('btnTemaPanel').innerHTML = `<i class="fas ${oscuro ? 'fa-sun' : 'fa-moon'}"></i>`;
    }
    $('btnTemaPanel').addEventListener('click', () => {
        const oscuro = document.documentElement.getAttribute('data-theme') === 'dark';
        if (oscuro) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', 'dark');
        try { localStorage.setItem('admin-theme', oscuro ? 'light' : 'dark'); } catch (e) {}
        iconoTema();
    });
    iconoTema();

    function mostrarError(html) {
        $('bandaErrorTexto').innerHTML = html;
        $('bandaError').hidden = false;
    }

    // ======================================================================
    // 9 · ARRANQUE
    // ======================================================================
    async function iniciar() {
        irA(location.hash.replace('#', '') || 'resumen');
        renderStats();
        const apiKey = typeof firebaseConfig !== 'undefined' ? String(firebaseConfig.apiKey || '') : '';
        if (!T.baseDatosUrl() || !apiKey || typeof firebase === 'undefined') {
            mostrarError('Falta completar <code>firebaseConfig</code> (con <code>databaseURL</code>) en <code>config.js</code>.');
            return;
        }
        try {
            firebase.initializeApp(firebaseConfig);
            db = firebase.database();
            const acceso = await window.TiendaAuth.asegurarAcceso({ global: true });
            yo = acceso.usuario;
            escuchar();
            await cargarTiendas();
        } catch (e) {
            console.error(e);
            mostrarError('No se pudieron leer los datos: ' + esc(window.TiendaAuth.mensajeDe(e)) +
                ' Si recién creaste el panel, publicá <code>database.rules.json</code> en Realtime Database → Reglas.');
        }
    }

    iniciar();
})();
