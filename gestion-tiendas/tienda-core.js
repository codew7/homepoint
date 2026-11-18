/* ==========================================================================
   TIENDA-CORE · núcleo compartido entre el catálogo público y el panel
   --------------------------------------------------------------------------
   Todo lo que tiene que dar EXACTAMENTE el mismo resultado en los dos lados
   vive acá: la configuración por defecto, la fusión con lo guardado en la
   Realtime Database, las gamas de colores, el cálculo del precio a partir del
   costo (columna E, o H según la tienda) y el formato de montos y teléfonos. Si el panel y el
   catálogo calcularan cada uno por su cuenta, el simulador de precios del
   panel podría mostrar una cifra distinta a la de la tarjeta.

   No depende del SDK de Firebase: el catálogo lee la base por REST, así sus
   clientes no descargan el SDK y nunca tienen forma de escribir en ella.
   Requiere config.js cargado antes (TIENDA_ID, firebaseConfig).
   ========================================================================== */
(function (global) {
    'use strict';

    // ---------------------------------------------------------------------
    // 1 · CONFIGURACIÓN POR DEFECTO
    // Neutra a propósito: sin marca, sin teléfonos. Es lo que ve una tienda
    // recién creada y la base sobre la que se fusiona lo guardado.
    // ---------------------------------------------------------------------
    const ESCALAS_SUGERIDAS = [
        { hasta: 2500,   pct: 75 },
        { hasta: 5000,   pct: 70 },
        { hasta: 10000,  pct: 65 },
        { hasta: 15000,  pct: 60 },
        { hasta: 20000,  pct: 55 },
        { hasta: 30000,  pct: 50 },
        { hasta: 40000,  pct: 45 },
        { hasta: 50000,  pct: 40 },
        { hasta: 70000,  pct: 30 },
        { hasta: 100000, pct: 20 }
    ];

    const DEFAULTS = {
        identidad: {
            nombreComercial: 'Mi Tienda',
            eslogan: 'Catálogo online',
            tituloPagina: 'Catálogo',
            descripcionPie: '',
            logoClaro: '',      // id de asset
            logoOscuro: '',     // id de asset (si falta se usa el claro)
            favicon: ''         // id de asset (si falta se dibuja la inicial)
        },
        contacto: {
            whatsappPedidos: '',
            contactos: [],      // [{ nombre, detalle, telefono, icono }]
            email: '',
            direccion: '',
            mapsUrl: '',
            horario: '',
            redes: { instagram: '', facebook: '', tiktok: '' }
        },
        textos: {
            anuncio: { activo: false, texto: '' },
            franja: [
                { icono: 'truck', titulo: 'Envíos a todo el país', texto: 'Coordinamos la entrega por WhatsApp' },
                { icono: 'dollar-sign', titulo: 'Precios en pesos', texto: 'Actualizados todos los días' }
            ],
            aviso: { activo: false, titulo: 'Aviso importante', texto: '' },
            pieLegal: 'Los precios publicados pueden modificarse sin previo aviso.'
        },
        bienvenida: {
            activa: false,
            titulo: 'Bienvenido al catálogo',
            subtitulo: 'Preguntas frecuentes',
            faqs: []            // [{ pregunta, respuesta }]
        },
        apariencia: {
            tema: 'bosque',
            colorPrimario: '#376550',
            colorAcento: '#12365c',
            modoInicial: 'sistema',     // 'sistema' | 'claro' | 'oscuro'
            permitirCambioModo: true,
            tipografia: 'Plus Jakarta Sans',
            estilo: 'clasico'           // ver ESTILOS (sección 3b)
        },
        precios: {
            escalas: ESCALAS_SUGERIDAS,
            pctExcedente: 10,           // % para costos por encima de la última escala
            ajusteGlobal: 0,            // % extra sobre todo (puede ser negativo)
            redondeo: 10,               // múltiplo hacia arriba: 1, 10, 50, 100, 500, 1000
            sinCosto: 'ocultar'         // 'ocultar' | 'consultar'
        },
        pedido: {
            montoMinimo: 0,
            descuento: { activo: false, montoDesde: 100000, unidadesDesde: 5, pct: 10, nota: '' },
            formasEntrega: [],          // opcional: si queda vacío, no se pregunta
            pedirDireccion: 'no',       // 'no' | 'opcional' | 'requerido'
            pedirDni: 'no',             // 'no' | 'opcional' | 'requerido'
            pedirNotas: false,
            textoConfirmacion: 'Te vamos a responder por WhatsApp para coordinar el pago y la entrega.'
        },
        catalogo: {
            mostrarStock: true,
            soloDisponiblesPorDefecto: true,
            pedidosSinStock: false,   // true: se puede pedir aunque no haya stock (sin tope por disponibilidad)
            mostrarCodigo: true,
            productosPorPagina: 30,
            categoriasOcultas: [],
            articulosOcultos: []      // claves (código o, si no tiene, nombre) que no se muestran
        },
        banners: {
            superior: [],       // [{ desktop: assetId, movil: assetId }]
            inferior: []
        },
        actualizado: 0
    };

    // ---------------------------------------------------------------------
    // 2 · FUSIÓN CON LO GUARDADO
    // La Realtime Database no guarda arrays vacíos ni objetos vacíos: si el
    // vendedor borra todos sus contactos, el nodo directamente desaparece.
    // Por eso, cuando la config ya fue guardada alguna vez (tiene
    // "actualizado"), un array ausente significa "vacío" y no "usar el
    // default". Sin esta regla, borrar todo devolvería los valores de fábrica.
    // ---------------------------------------------------------------------
    function esObjetoPlano(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function aArray(v) {
        if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined);
        if (esObjetoPlano(v)) {
            return Object.keys(v)
                .sort((a, b) => Number(a) - Number(b))
                .map(k => v[k])
                .filter(x => x !== null && x !== undefined);
        }
        return [];
    }

    function clonar(v) {
        return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    }

    function fusionar(base, remoto, guardado) {
        if (Array.isArray(base)) {
            if (remoto === undefined || remoto === null) return guardado ? [] : clonar(base);
            return clonar(aArray(remoto));
        }
        if (esObjetoPlano(base)) {
            const fuente = esObjetoPlano(remoto) ? remoto : {};
            const out = {};
            Object.keys(base).forEach(k => { out[k] = fusionar(base[k], fuente[k], guardado); });
            return out;
        }
        if (remoto === undefined || remoto === null) return base;
        if (typeof base === 'number') {
            const n = Number(remoto);
            return isFinite(n) ? n : base;
        }
        if (typeof base === 'boolean') return remoto === true || remoto === 'true';
        return String(remoto);
    }

    function normalizarConfig(remoto) {
        const guardado = esObjetoPlano(remoto) && !!remoto.actualizado;
        return fusionar(DEFAULTS, remoto, guardado);
    }

    // ---------------------------------------------------------------------
    // 3 · GAMAS DE COLORES
    // El CSS del catálogo está construido sobre tokens (--verde-600, etc.).
    // Una gama no es más que un color principal y uno de acento: el resto de
    // la escala, en claro y en oscuro, se deriva acá. Así una gama
    // "Personalizada" se comporta igual de bien que una de fábrica.
    // ---------------------------------------------------------------------
    const TEMAS = {
        bosque:    { nombre: 'Bosque',     primario: '#376550', acento: '#12365c' },
        oceano:    { nombre: 'Océano',     primario: '#1f5f8b', acento: '#0e3a5a' },
        terracota: { nombre: 'Terracota',  primario: '#b4532a', acento: '#6b2f1a' },
        grafito:   { nombre: 'Grafito',    primario: '#3a4250', acento: '#1f2937' },
        ciruela:   { nombre: 'Ciruela',    primario: '#6b3fa0', acento: '#3b1f5e' },
        arena:     { nombre: 'Arena',      primario: '#9a6b1f', acento: '#5c4313' },
        frambuesa: { nombre: 'Frambuesa',  primario: '#b03a62', acento: '#5e1f36' },
        petroleo:  { nombre: 'Petróleo',   primario: '#0f6b6b', acento: '#0a3d4a' }
    };

    const TIPOGRAFIAS = ['Plus Jakarta Sans', 'Inter', 'Manrope', 'DM Sans', 'Poppins', 'Outfit'];

    function hexARgb(hex) {
        let h = String(hex || '').replace('#', '').trim();
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (!/^[0-9a-f]{6}$/i.test(h)) return null;
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }

    function rgbAHsl({ r, g, b }) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return { h, s: s * 100, l: l * 100 };
    }

    function hsl(h, s, l) {
        const lim = (v) => Math.max(0, Math.min(100, v));
        return `hsl(${Math.round(h)} ${lim(s).toFixed(1)}% ${lim(l).toFixed(1)}%)`;
    }

    function coloresDeTema(apariencia) {
        const a = apariencia || DEFAULTS.apariencia;
        const preset = TEMAS[a.tema];
        const primario = preset ? preset.primario : (hexARgb(a.colorPrimario) ? a.colorPrimario : DEFAULTS.apariencia.colorPrimario);
        const acento = preset ? preset.acento : (hexARgb(a.colorAcento) ? a.colorAcento : primario);
        return { primario, acento };
    }

    function tokensDeTema(apariencia) {
        const { primario, acento } = coloresDeTema(apariencia);
        const p = rgbAHsl(hexARgb(primario));
        const ac = rgbAHsl(hexARgb(acento));
        const rgb = hexARgb(primario);
        // Un primario muy claro no sostiene texto blanco encima: se oscurece
        // hasta un nivel legible para los botones.
        const l600 = Math.min(p.l, 46);
        const sMod = Math.min(p.s, 70);

        const claro = {
            '--verde-600': hsl(p.h, p.s, l600),
            '--verde-700': hsl(p.h, p.s, l600 - 7),
            '--verde-800': hsl(p.h, p.s, Math.max(l600 - 14, 14)),
            '--verde-100': hsl(p.h, sMod * 0.4, 87),
            '--verde-050': hsl(p.h, sMod * 0.35, 95.5),
            '--navy': hsl(ac.h, ac.s, Math.min(ac.l, 32)),
            '--anillo': `rgba(${rgb.r},${rgb.g},${rgb.b},.16)`
        };
        const oscuro = {
            '--verde-600': hsl(p.h, sMod, Math.max(l600, 36)),
            '--verde-700': hsl(p.h, Math.min(sMod, 58), 60),
            '--verde-800': hsl(p.h, Math.min(sMod, 55), 56),
            '--verde-100': hsl(p.h, sMod * 0.45, 16),
            '--verde-050': hsl(p.h, sMod * 0.4, 11),
            '--navy': hsl(ac.h === p.h ? p.h : ac.h, Math.min(ac.s, 55), 60),
            '--anillo': `rgba(${rgb.r},${rgb.g},${rgb.b},.32)`
        };
        return { claro, oscuro };
    }

    // ---------------------------------------------------------------------
    // 3b · ESTILOS DEL CATÁLOGO
    // Tres personalidades sobre el mismo HTML. El estilo se marca con
    // data-estilo en <html> y lo dibuja estilos.css; "clasico" es el diseño
    // original y no agrega nada. Cada estilo puede traer su propia tipografía
    // de títulos y precios (--display): el texto general sigue siendo la
    // tipografía que eligió la tienda.
    // ---------------------------------------------------------------------
    const ESTILOS = {
        clasico:  { nombre: 'Clásico',  descripcion: 'Ordenado y directo, con tarjetas bien definidas.' },
        boutique: { nombre: 'Boutique', descripcion: 'Editorial y cálido: tipografía con serifa, papel marfil y mucho aire.',
                    display: 'Fraunces', fuente: 'Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600' },
        vitrina:  { nombre: 'Vitrina',  descripcion: 'Inmersivo y moderno: vidrio esmerilado, formas redondeadas y productos iluminados.',
                    display: 'Bricolage Grotesque', fuente: 'Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800' }
    };

    function estiloDe(apariencia) {
        const e = apariencia && apariencia.estilo;
        return ESTILOS[e] ? e : 'clasico';
    }

    function urlFuenteEstilo(estilo) {
        const e = ESTILOS[estilo];
        return e && e.fuente ? 'https://fonts.googleapis.com/css2?family=' + e.fuente + '&display=swap' : '';
    }

    function familiaTipografia(nombre) {
        const n = TIPOGRAFIAS.includes(nombre) ? nombre : TIPOGRAFIAS[0];
        return `'${n}','Segoe UI',system-ui,-apple-system,sans-serif`;
    }

    function urlTipografia(nombre) {
        const n = TIPOGRAFIAS.includes(nombre) ? nombre : TIPOGRAFIAS[0];
        return 'https://fonts.googleapis.com/css2?family=' + n.replace(/ /g, '+') + ':wght@400;500;600;700;800&display=swap';
    }

    function cssDeTema(apariencia) {
        const t = tokensDeTema(apariencia);
        const decl = (obj) => Object.keys(obj).map(k => `${k}:${obj[k]};`).join('');
        const fuente = familiaTipografia(apariencia && apariencia.tipografia);
        const est = ESTILOS[estiloDe(apariencia)];
        const display = est.display ? `'${est.display}',${fuente}` : fuente;
        // html:root y no :root: el <style> de la gama se inserta en el <head>
        // antes que la hoja principal, así que necesita más especificidad
        // para ganarle a los tokens de la sección 1 sin depender del orden.
        return `html:root{${decl(t.claro)}--ui:${fuente};--display:${display};}` +
               `html:root[data-theme="dark"]{${decl(t.oscuro)}}`;
    }

    // Aplica la gama en el documento actual: un <style> propio que redefine
    // los tokens (le gana a la sección 1 del CSS por ir después) y el link de
    // la tipografía elegida.
    function aplicarTemaEnDocumento(apariencia, doc) {
        doc = doc || document;
        let st = doc.getElementById('tema-tienda');
        if (!st) {
            st = doc.createElement('style');
            st.id = 'tema-tienda';
            doc.head.appendChild(st);
        }
        st.textContent = cssDeTema(apariencia);

        const href = urlTipografia(apariencia && apariencia.tipografia);
        let link = doc.getElementById('fuente-tienda');
        if (!link) {
            link = doc.createElement('link');
            link.id = 'fuente-tienda';
            link.rel = 'stylesheet';
            doc.head.appendChild(link);
        }
        if (link.getAttribute('href') !== href) link.setAttribute('href', href);

        // Estilo del catálogo (sección 3b): la marca en <html> y su tipografía
        const estilo = estiloDe(apariencia);
        if (estilo === 'clasico') doc.documentElement.removeAttribute('data-estilo');
        else doc.documentElement.setAttribute('data-estilo', estilo);
        const hrefEstilo = urlFuenteEstilo(estilo);
        let linkEstilo = doc.getElementById('fuente-estilo');
        if (hrefEstilo && !linkEstilo) {
            linkEstilo = doc.createElement('link');
            linkEstilo.id = 'fuente-estilo';
            linkEstilo.rel = 'stylesheet';
            doc.head.appendChild(linkEstilo);
        }
        if (linkEstilo && hrefEstilo && linkEstilo.getAttribute('href') !== hrefEstilo) linkEstilo.setAttribute('href', hrefEstilo);
    }

    // Modo inicial (claro/oscuro) respetando la elección manual del visitante
    // si la tienda le permite cambiarlo.
    function modoInicial(apariencia) {
        const a = apariencia || DEFAULTS.apariencia;
        if (a.permitirCambioModo) {
            let manual = null;
            try { manual = localStorage.getItem('theme'); } catch (e) {}
            if (manual === 'dark' || manual === 'light') return manual;
        }
        if (a.modoInicial === 'oscuro') return 'dark';
        if (a.modoInicial === 'claro') return 'light';
        return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // ---------------------------------------------------------------------
    // 4 · PRECIOS
    // Precio = costo (col. E o H, ver 4b) × (1 + % de su escala) × (1 + ajuste global),
    // redondeado hacia arriba al múltiplo elegido. La escala se busca por el
    // costo: "Hasta $2.500" incluye los $2.500.
    // ---------------------------------------------------------------------
    function parsearMonto(valor) {
        if (typeof valor === 'number') return valor;
        let s = String(valor == null ? '' : valor).trim();
        if (!s) return NaN;
        s = s.replace(/[^0-9.,-]/g, '');
        // "12.345,67" (es-AR) → "12345.67"; "12,345.67" (en-US) → "12345.67"
        const ultComa = s.lastIndexOf(','), ultPunto = s.lastIndexOf('.');
        if (ultComa > -1 && ultPunto > -1) {
            s = ultComa > ultPunto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
        } else if (ultComa > -1) {
            // Sólo comas: si la última deja 3 dígitos es separador de miles
            s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
            // Sólo puntos agrupando de a tres ("12.345"): separador de miles
            s = s.replace(/\./g, '');
        }
        const n = parseFloat(s);
        return isFinite(n) ? n : NaN;
    }

    function escalasOrdenadas(precios) {
        return aArray(precios && precios.escalas)
            .map(e => ({ hasta: Number(e.hasta), pct: Number(e.pct) }))
            .filter(e => isFinite(e.hasta) && e.hasta > 0 && isFinite(e.pct))
            .sort((a, b) => a.hasta - b.hasta);
    }

    function escalaDe(costo, precios) {
        const escalas = escalasOrdenadas(precios);
        for (let i = 0; i < escalas.length; i++) {
            if (costo <= escalas[i].hasta) {
                return { pct: escalas[i].pct, indice: i, hasta: escalas[i].hasta, desde: i ? escalas[i - 1].hasta : 0 };
            }
        }
        const ult = escalas.length ? escalas[escalas.length - 1].hasta : 0;
        const pct = Number(precios && precios.pctExcedente);
        return { pct: isFinite(pct) ? pct : 0, indice: escalas.length, hasta: null, desde: ult };
    }

    function calcularPrecio(costoBruto, precios) {
        const costo = parsearMonto(costoBruto);
        if (!isFinite(costo) || costo <= 0) return null;
        const p = precios || DEFAULTS.precios;
        const escala = escalaDe(costo, p);
        const ajuste = Number(p.ajusteGlobal) || 0;
        let precio = costo * (1 + escala.pct / 100) * (1 + ajuste / 100);
        const r = Math.max(1, Number(p.redondeo) || 1);
        precio = Math.ceil(Math.round(precio * 100) / 100 / r) * r;
        return precio;
    }

    function detallePrecio(costoBruto, precios) {
        const costo = parsearMonto(costoBruto);
        if (!isFinite(costo) || costo <= 0) return null;
        const escala = escalaDe(costo, precios || DEFAULTS.precios);
        return { costo, escala, precio: calcularPrecio(costo, precios) };
    }

    // ---------------------------------------------------------------------
    // 4b · DE QUÉ COLUMNA SALE EL COSTO
    // "Variable de costos": la decide el admin global por tienda
    // (tiendas/<id>/costo; el vendedor no la puede cambiar):
    //   · sin nodo / 'interior' → columna E (Descuento Interior), por defecto
    //   · 'costo'               → columna H (Valor Costo)
    //   · 'costoPct'            → columna H + un % (Costo %; 0 % = Valor Costo)
    //   · 'lista'               → columna G (Precio de Lista)
    // Ese costo es la base de las escalas y el que queda en cada pedido.
    // ---------------------------------------------------------------------
    const COLUMNA_COSTO = { E: 4, G: 6, H: 7 };   // índices base 0 en la fila de la hoja
    const MODOS_COSTO = ['interior', 'costo', 'costoPct', 'lista'];

    function normalizarReglaCosto(r) {
        const modo = r && MODOS_COSTO.includes(r.modo) ? r.modo : 'interior';
        const pct = Number(r && r.pct);
        return { modo, pct: modo === 'costoPct' && isFinite(pct) ? pct : 0 };
    }

    function costoDeFila(fila, regla) {
        const r = normalizarReglaCosto(regla);
        if (r.modo === 'interior') return parsearMonto(fila && fila[COLUMNA_COSTO.E]);
        if (r.modo === 'lista') return parsearMonto(fila && fila[COLUMNA_COSTO.G]);
        const h = parsearMonto(fila && fila[COLUMNA_COSTO.H]);
        if (!isFinite(h)) return NaN;
        return r.modo === 'costoPct' ? Math.round(h * (1 + r.pct / 100) * 100) / 100 : h;
    }

    function textoReglaCosto(regla) {
        const r = normalizarReglaCosto(regla);
        if (r.modo === 'costo') return 'Valor Costo';
        if (r.modo === 'lista') return 'Precio de Lista';
        if (r.modo === 'costoPct') return `Costo % ${r.pct >= 0 ? '+' : '−'}${Math.abs(r.pct)}%`;
        return 'Descuento Interior';
    }

    const _fmt = (global.Intl && Intl.NumberFormat) ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }) : null;
    function formatearNumero(n) {
        const v = Math.round(Number(n) || 0);
        return _fmt ? _fmt.format(v) : String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    function formatearMonto(n) { return '$' + formatearNumero(n); }

    // ---------------------------------------------------------------------
    // 5 · TELÉFONOS Y WHATSAPP
    // Se aceptan como los escribe la gente ("11 2345-6789", "+54 9 11…",
    // "011 15 2345 6789") y se llevan al formato internacional que pide
    // WhatsApp. Números de 10 dígitos se toman como argentinos.
    // ---------------------------------------------------------------------
    function normalizarWhatsApp(valor) {
        let d = String(valor || '').replace(/\D/g, '');
        if (!d) return '';
        if (d.startsWith('00')) d = d.slice(2);
        if (d.startsWith('54')) {
            let resto = d.slice(2);
            if (resto.startsWith('9')) resto = resto.slice(1);
            if (resto.startsWith('0')) resto = resto.slice(1);
            resto = quitar15(resto);
            return resto.length === 10 ? '549' + resto : d;
        }
        if (d.startsWith('0')) d = d.slice(1);
        d = quitar15(d);
        if (d.length === 10) return '549' + d;
        return d.length >= 8 ? d : '';
    }

    function quitar15(d) {
        if (d.length === 12) {
            for (const corte of [2, 3, 4]) {
                if (d.slice(corte, corte + 2) === '15') return d.slice(0, corte) + d.slice(corte + 2);
            }
        }
        return d;
    }

    function formatearTelefono(valor) {
        const d = normalizarWhatsApp(valor);
        if (/^549\d{10}$/.test(d)) {
            const n = d.slice(3);
            const area = n.startsWith('11') ? 2 : (n.startsWith('2') || n.startsWith('3') ? 3 : 2);
            const a = n.slice(0, area), resto = n.slice(area);
            const corte = resto.length - 4;
            return `+54 9 ${a} ${resto.slice(0, corte)}-${resto.slice(corte)}`;
        }
        return d ? '+' + d : '';
    }

    function urlWhatsApp(numero, texto) {
        const d = normalizarWhatsApp(numero);
        if (!d) return '';
        return 'https://api.whatsapp.com/send?phone=' + d + (texto ? '&text=' + encodeURIComponent(texto) : '');
    }

    // ---------------------------------------------------------------------
    // 6 · LECTURA REMOTA (REST) Y CACHÉ
    // ---------------------------------------------------------------------
    // ---- ¿Qué tienda es? ----
    // Un solo sitio sirve a todas las tiendas; la tienda sale de la dirección:
    //   https://catalog.dev.ar/lucia            → lucia
    //   https://codew7.github.io/catalog/lucia  → lucia
    //   …/?t=lucia                              → lucia (lo usa 404.html)
    // BASE_SITIO es la carpeta desde donde se cargó este archivo, así funciona
    // igual en la raíz de un dominio o en una subcarpeta de GitHub Pages.
    const ID_TIENDA_VALIDO = /^[a-z0-9][a-z0-9-]{1,30}$/;
    const IDS_RESERVADOS = ['admin', 'principal', 'index', 'api', 'img', 'assets', 'www', 'catalogo', 'tienda', 'registro', 'pedido'];

    // En el repositorio de gestión, config.js define SITIO_PUBLICO (la
    // dirección del catálogo público) para armar los enlaces de cada tienda.
    const BASE_SITIO = (function () {
        try {
            if (typeof SITIO_PUBLICO !== 'undefined' && SITIO_PUBLICO) {
                return new URL(String(SITIO_PUBLICO).replace(/\/*$/, '/')).href;
            }
            const s = global.document && global.document.currentScript && global.document.currentScript.src;
            if (s) return new URL('.', s).href;
            if (global.location) return new URL('.', global.location.href).href;
        } catch (e) {}
        return '/';
    })();

    function idValido(id) { return ID_TIENDA_VALIDO.test(id || '') && !IDS_RESERVADOS.includes(id); }

    function tiendaDeUrl() {
        if (!global.location) return '';
        const p = new URLSearchParams(global.location.search);
        const q = String(p.get('t') || p.get('tienda') || '').trim().toLowerCase();
        if (idValido(q)) return q;
        try {
            const base = new URL(BASE_SITIO);
            if (global.location.origin === base.origin && global.location.pathname.indexOf(base.pathname) === 0) {
                const seg = decodeURIComponent(global.location.pathname.slice(base.pathname.length).split('/')[0] || '').toLowerCase();
                if (idValido(seg)) return seg;
            }
        } catch (e) {}
        return '';
    }

    function tiendaId() {
        if (global.__TIENDA_ID_FORZADA) return global.__TIENDA_ID_FORZADA;
        const deUrl = tiendaDeUrl();
        if (deUrl) return deUrl;
        // Respaldo: TIENDA_ID de config.js (pruebas locales o un deploy propio)
        return typeof TIENDA_ID !== 'undefined' && TIENDA_ID ? TIENDA_ID : '';
    }

    // Direcciones "lindas" de una tienda en el sitio público
    function urlTienda(id) { return BASE_SITIO + encodeURIComponent(id); }
    function urlPanelTienda(id) { return BASE_SITIO + encodeURIComponent(id) + '/admin'; }

    function baseDatosUrl() {
        const url = (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.databaseURL) || '';
        // http sólo se acepta en localhost (emulador o pruebas locales)
        return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(url) ? url.replace(/\/+$/, '') : '';
    }

    function urlNodo(ruta) {
        const base = baseDatosUrl();
        const id = tiendaId();
        return base && id ? `${base}/tiendas/${encodeURIComponent(id)}/${ruta}.json` : '';
    }

    function pedirConfigRemota() {
        const url = urlNodo('config');
        if (!url || typeof fetch !== 'function') return Promise.resolve(null);
        return fetch(url, { cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }

    // Estado de la tienda (lo maneja la gestión de tiendas): { activa, mensaje }
    function pedirEstadoRemoto() {
        const url = urlNodo('estado');
        if (!url || typeof fetch !== 'function') return Promise.resolve(null);
        return fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    }

    // Regla de costo de la tienda (ver 4b). Sin nodo o con error → null (columna E).
    function pedirReglaCostoRemota() {
        const url = urlNodo('costo');
        if (!url || typeof fetch !== 'function') return Promise.resolve(null);
        return fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    }

    const CLAVE_CACHE = () => 'tienda:' + tiendaId();
    const CLAVE_ASSET = (id) => 'tienda-asset:' + id;

    function leerCache() {
        try {
            const crudo = localStorage.getItem(CLAVE_CACHE());
            return crudo ? JSON.parse(crudo) : null;
        } catch (e) { return null; }
    }

    function guardarCache(remoto) {
        try { localStorage.setItem(CLAVE_CACHE(), JSON.stringify(remoto)); } catch (e) {}
    }

    // Ids de imágenes referenciadas por una config (logos, favicon, banners)
    function assetsDeConfig(cfg) {
        const ids = [];
        const id = cfg.identidad || {};
        [id.logoClaro, id.logoOscuro, id.favicon].forEach(x => { if (x) ids.push(x); });
        ['superior', 'inferior'].forEach(k => {
            aArray(cfg.banners && cfg.banners[k]).forEach(s => {
                if (s && s.desktop) ids.push(s.desktop);
                if (s && s.movil) ids.push(s.movil);
            });
        });
        return Array.from(new Set(ids));
    }

    // Las imágenes son inmutables (un id nuevo por cada subida), así que una
    // vez descargadas se pueden guardar para siempre en el navegador.
    function leerAssetCache(id) {
        try { return localStorage.getItem(CLAVE_ASSET(id)); } catch (e) { return null; }
    }

    function pedirAsset(id) {
        const enCache = leerAssetCache(id);
        if (enCache) return Promise.resolve(enCache);
        const url = urlNodo('assets/' + encodeURIComponent(id));
        if (!url) return Promise.resolve(null);
        return fetch(url)
            .then(r => r.ok ? r.json() : null)
            .then(a => {
                const dataUrl = a && a.dataUrl;
                if (dataUrl) { try { localStorage.setItem(CLAVE_ASSET(id), dataUrl); } catch (e) {} }
                return dataUrl || null;
            })
            .catch(() => null);
    }

    // Borra del navegador las imágenes que la config vigente ya no usa
    function limpiarAssetsHuerfanos(idsVigentes) {
        try {
            const vigentes = new Set(idsVigentes);
            const borrar = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf('tienda-asset:') === 0 && !vigentes.has(k.slice(13))) borrar.push(k);
            }
            borrar.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
    }

    // ---------------------------------------------------------------------
    // 7 · UTILIDADES
    // ---------------------------------------------------------------------
    function escaparHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Texto libre del vendedor → HTML seguro: escapa todo, respeta saltos de
    // línea y admite **negrita** como único formato.
    function textoEnriquecido(s) {
        return escaparHtml(s)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function leerRuta(obj, ruta) {
        return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    }

    function escribirRuta(obj, ruta, valor) {
        const partes = ruta.split('.');
        let o = obj;
        for (let i = 0; i < partes.length - 1; i++) {
            // Admite índices de array en la ruta ("banners.superior.0.desktop")
            if (o[partes[i]] === null || typeof o[partes[i]] !== 'object') o[partes[i]] = {};
            o = o[partes[i]];
        }
        o[partes[partes.length - 1]] = valor;
    }

    // ---------------------------------------------------------------------
    // Pedidos guardados en tiendas/<id>/pedidos
    // ---------------------------------------------------------------------
    const DIAS_PEDIDOS = 90;                      // los más viejos se borran solos
    const ESTADOS_PEDIDO = { ABIERTO: 'ABIERTO', ENTREGADO: 'ENTREGADO' };
    const ALFABETO_PEDIDO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I

    function generarNumeroPedido() {
        const n = new Uint8Array(5);
        (global.crypto || global.msCrypto).getRandomValues(n);
        return Array.from(n, b => ALFABETO_PEDIDO[b % ALFABETO_PEDIDO.length]).join('');
    }

    function validarEmail(valor) {
        const v = String(valor || '').trim();
        return v.length <= 120 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
    }

    function limitePedidos(ahora) { return (ahora || Date.now()) - DIAS_PEDIDOS * 864e5; }

    // ---- Compras por email (tiendas/<id>/compras/<email>/<pedido>) ----
    // Copia mínima de cada pedido, agrupada por el email del comprador, para
    // la opción "Ingresar" del catálogo. Sólo lo que el comprador ya conoce:
    // número, fecha, estado, artículos y total (nunca costos, teléfono, DNI
    // ni notas). Se puede leer un email puntual, pero no listar los emails.
    // La escribe el checkout al confirmar y la mantiene al día el panel.
    //
    // La clave es el email en minúsculas con "." → "," (Firebase no acepta
    // puntos en las claves). Las reglas comprueban esa misma conversión.
    function claveEmail(email) {
        const e = String(email || '').trim().toLowerCase();
        if (!validarEmail(e) || /[#$\[\]\/]/.test(e)) return '';
        return e.replace(/\./g, ',');
    }

    // Claves en orden alfabético: así el panel compara con lo guardado
    // (Firebase devuelve las claves ordenadas) con un simple JSON.stringify.
    function resumenCompra(p) {
        p = p || {};
        return {
            fecha: Number(p.fecha) || 0,
            items: aArray(p.items).map(it => ({
                cantidad: Number(it.cantidad) || 0,
                nombre: String(it.nombre || '').slice(0, 160),
                precio: Number(it.precio) || 0
            })),
            numero: String(p.numero || ''),
            status: p.status === ESTADOS_PEDIDO.ENTREGADO ? ESTADOS_PEDIDO.ENTREGADO : ESTADOS_PEDIDO.ABIERTO,
            total: Number(p.total) || 0
        };
    }

    // Favicon de respaldo: la inicial de la tienda sobre su color principal
    function faviconInicial(nombre, apariencia) {
        const { primario } = coloresDeTema(apariencia);
        const letra = escaparHtml((String(nombre || 'T').trim()[0] || 'T').toUpperCase());
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${primario}"/><text x="32" y="43" font-family="Arial,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#fff">${letra}</text></svg>`;
        return 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    global.TiendaCore = {
        DEFAULTS, ESCALAS_SUGERIDAS, TEMAS, TIPOGRAFIAS, ESTILOS, estiloDe, urlFuenteEstilo,
        normalizarConfig, aArray, clonar,
        coloresDeTema, tokensDeTema, cssDeTema, aplicarTemaEnDocumento, modoInicial, urlTipografia, familiaTipografia,
        parsearMonto, escalasOrdenadas, escalaDe, calcularPrecio, detallePrecio, formatearNumero, formatearMonto,
        COLUMNA_COSTO, MODOS_COSTO, normalizarReglaCosto, costoDeFila, textoReglaCosto, pedirReglaCostoRemota,
        normalizarWhatsApp, formatearTelefono, urlWhatsApp,
        tiendaId, idValido, urlTienda, urlPanelTienda, BASE_SITIO, IDS_RESERVADOS, baseDatosUrl, urlNodo, pedirConfigRemota, pedirEstadoRemoto, leerCache, guardarCache,
        assetsDeConfig, leerAssetCache, pedirAsset, limpiarAssetsHuerfanos,
        escaparHtml, textoEnriquecido, leerRuta, escribirRuta, faviconInicial,
        DIAS_PEDIDOS, ESTADOS_PEDIDO, generarNumeroPedido, validarEmail, limitePedidos, claveEmail, resumenCompra
    };
})(window);
