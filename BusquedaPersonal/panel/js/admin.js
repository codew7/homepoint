// =====================================================================
//  Panel de administración: listado, filtros, ficha, perfil, CV,
//  invitaciones por WhatsApp y configuración.
// =====================================================================

import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, onValue, update, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { app, db, configurado, mensajeError } from "./firebase.js";
import { SITIO } from "../config/sitio.js";
import { RASGOS, PESOS_DEFECTO, calcularPerfil, versionPublica, revisarCuestionario } from "./puntajes.js";

// ---------- Utilidades ----------
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normalizar = t => String(t ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();   // quita los acentos
const siNo = v => (v === true ? "Sí" : v === false ? "No" : "—");
const pesos$ = n => (n ? "$ " + Number(n).toLocaleString("es-AR") : "No indicada");
const minusculaInicial = t => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const fechaHora = ts => (ts ? new Date(ts).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fechaCorta = ts => (ts ? new Date(ts).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const fechaISO = iso => (iso ? iso.split("-").reverse().join("/") : "—");
function edad(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-").map(Number);
  const hoy = new Date();
  let e = hoy.getFullYear() - a;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--;
  return e;
}
function telVisible(t) {
  const d = String(t || "").replace(/^549/, "");
  if (d.length !== 10) return t || "—";
  return d.startsWith("11") ? `11 ${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, d.length - 7)} ${d.slice(-7, -4)}-${d.slice(-4)}`;
}
function normalizarTelefono(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 12) for (const l of [2, 3, 4]) if (d.substr(l, 2) === "15") { d = d.slice(0, l) + d.slice(l + 2); break; }
  return d.length === 10 && !d.startsWith("15") ? "549" + d : null;
}
let tostadaT;
function tostada(texto) {
  const t = $("#tostada");
  t.textContent = texto;
  t.classList.add("visible");
  clearTimeout(tostadaT);
  tostadaT = setTimeout(() => t.classList.remove("visible"), 2600);
}
function okBreve(sel) { const e = $(sel); e.hidden = false; setTimeout(() => (e.hidden = true), 2500); }

const CONF_TXT = { Alto: "alta", Medio: "media", Bajo: "baja" };
const ESTADOS = ["Nuevo", "Preseleccionado", "Entrevista", "Contratado", "Descartado"];
const NOMBRES_RASGOS_DEFECTO = { AUT: "Autonomía", HON: "Honestidad", NOR: "Apego a normas", PRO: "Proactividad y compromiso", DES: "Manejo constructivo de desacuerdos" };

// ---------- Estado ----------
let postulaciones = [];         // [{ id, ...datos, _perfil }]
let config = {};                // configuracion/*
let puestosPublicos = null;     // publico/puestos
let filtros = {};
let fichaAbierta = null;        // id de la ficha abierta
let desuscribir = [];

const nombresRasgos = () => ({ ...NOMBRES_RASGOS_DEFECTO, ...(config.cuestionario?.rasgos || {}) });

// =====================================================================
//  Login
// =====================================================================
if (!configurado) {
  $("#cargando").hidden = true;
  $("#vista-login").hidden = false;
  $("#login-error").textContent = "Falta pegar las credenciales de Firebase en config/firebase-config.js.";
  $("#btn-login").disabled = true;
} else {
  const auth = getAuth(app);

  $("#form-login").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const clave = $("#login-clave").value;
    $("#login-error").textContent = "";
    if (!email || !clave) { $("#login-error").textContent = "Completá email y contraseña."; return; }
    $("#btn-login").disabled = true;
    $("#btn-login").textContent = "Ingresando…";
    try {
      await signInWithEmailAndPassword(auth, email, clave);
    } catch (err) {
      const c = String(err.code || "");
      $("#login-error").textContent = /invalid|wrong|not-found|credential/.test(c) ? "Email o contraseña incorrectos."
        : c.includes("too-many") ? "Demasiados intentos. Esperá unos minutos." : mensajeError(err);
    } finally {
      $("#btn-login").disabled = false;
      $("#btn-login").textContent = "Ingresar";
    }
  });

  $("#btn-salir").addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async user => {
    desuscribir.forEach(f => f()); desuscribir = [];
    $("#cargando").hidden = true;
    if (!user) { $("#vista-panel").hidden = true; $("#vista-login").hidden = false; return; }
    // ¿Está autorizado? (figura en el nodo admins)
    let autorizado = false;
    try { autorizado = (await get(ref(db, `admins/${user.uid}`))).val() === true; } catch { /* sin permiso = no autorizado */ }
    if (!autorizado) {
      await signOut(auth);
      $("#login-error").textContent = `Este usuario no está autorizado. Para habilitarlo, agregá su UID (${user.uid}) al nodo "admins" desde la consola de Firebase.`;
      return;
    }
    $("#vista-login").hidden = true;
    $("#vista-panel").hidden = false;
    $("#usuario-email").textContent = user.email || "";
    iniciarPanel();
  });
}

// =====================================================================
//  Panel
// =====================================================================
let panelIniciado = false;
function iniciarPanel() {
  if (!panelIniciado) { conectarEventos(); panelIniciado = true; }

  desuscribir.push(onValue(ref(db, "postulaciones"), snap => {
    const v = snap.val() || {};
    postulaciones = Object.entries(v).map(([id, d]) => ({ id, ...d }));
    recalcular();
  }, err => mostrarAvisoPanel(mensajeError(err))));

  desuscribir.push(onValue(ref(db, "configuracion"), snap => {
    config = snap.val() || {};
    recalcular();
    pintarConfiguracion();
  }, err => mostrarAvisoPanel(mensajeError(err))));

  desuscribir.push(onValue(ref(db, "publico/puestos"), snap => {
    puestosPublicos = snap.val();
    pintarPuestosAdmin();
  }));
}

function mostrarAvisoPanel(t) { const a = $("#aviso-panel"); a.textContent = t; a.hidden = false; }

function cuestionarioDe(p) {
  return config.historialCuestionario?.["v" + p.cuestionarioVersion] || config.cuestionario || null;
}

function recalcular() {
  const pesos = { ...PESOS_DEFECTO, ...(config.pesos || {}) };
  for (const p of postulaciones) p._perfil = calcularPerfil(p.respuestas || {}, cuestionarioDe(p), pesos);
  const nuevos = postulaciones.filter(p => p.estado === "Nuevo").length;
  const ins = $("#contador-nuevos");
  ins.textContent = nuevos;
  ins.hidden = !nuevos;
  ins.title = `${nuevos} postulaciones nuevas`;
  if (!config.cuestionario) mostrarAvisoPanel("Todavía no cargaste el cuestionario. Andá a Configuración > Cuestionario y cargá el archivo cuestionario.json.");
  else $("#aviso-panel").hidden = true;
  pintarFiltros();
  pintarLista();
  if (fichaAbierta && !$("#dlg-editar").open && document.activeElement?.id !== "notas-texto") pintarFicha(fichaAbierta);
}

function conectarEventos() {
  // Pestañas
  $$(".a-tab").forEach(t => t.addEventListener("click", () => cambiarTab(t.dataset.tab)));

  // Búsqueda, orden y filtros
  $("#buscar").addEventListener("input", pintarLista);
  $("#ordenar").innerHTML = [
    ["fecha-desc", "Más recientes"], ["fecha-asc", "Más antiguos"],
    ["general-desc", "Mayor puntaje general"],
    ...RASGOS.map(r => [`${r}-desc`, `Mayor ${NOMBRES_RASGOS_DEFECTO[r].toLowerCase()}`]),
    ["remu-asc", "Menor remuneración pretendida"], ["remu-desc", "Mayor remuneración pretendida"]
  ].map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  $("#ordenar").addEventListener("change", pintarLista);
  $("#btn-filtros").addEventListener("click", () => {
    const p = $("#panel-filtros");
    p.hidden = !p.hidden;
    $("#btn-filtros").setAttribute("aria-expanded", String(!p.hidden));
  });
  $("#btn-limpiar-filtros").addEventListener("click", () => { filtros = {}; pintarFiltros(); pintarLista(); });
  $("#btn-exportar").addEventListener("click", exportarCSV);

  // Cerrar diálogos
  $$("[data-cerrar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#dlg-ficha").addEventListener("close", () => { fichaAbierta = null; });
  // Cerrar la hoja tocando fuera
  $("#dlg-ficha").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // Configuración
  $("#form-entrevista").addEventListener("submit", guardarEntrevista);
  $$('input[name="ent-sucursal"]').forEach(r => r.addEventListener("change", () => {
    if (r.value !== "Otro") $("#ent-lugar").value = `nuestra sucursal de ${r.value} (${SITIO.sucursales[r.value]})`;
    else { $("#ent-lugar").value = ""; $("#ent-lugar").focus(); }
    previaEntrevista();
  }));
  ["#ent-fecha", "#ent-hora", "#ent-lugar"].forEach(s => $(s).addEventListener("input", previaEntrevista));
  $("#form-pesos").addEventListener("submit", guardarPesos);
  $("#btn-agregar-puesto").addEventListener("click", () => { const l = leerPuestosForm(); l.push({ id: "p" + Date.now(), titulo: "", descripcion: "", frase: "", activo: true, completo: false, sucursales: { Caseros: true, Munro: true } }); pintarPuestosAdmin(l); });
  $("#btn-guardar-puestos").addEventListener("click", guardarPuestos);
  $("#cuest-archivo").addEventListener("change", cargarArchivoCuestionario);
  $("#btn-cuest-editar").addEventListener("click", () => { $("#cuest-texto").value = JSON.stringify(sinVersion(config.cuestionario) || {}, null, 2); $("#cuest-editor").hidden = false; $("#cuest-error").textContent = ""; });
  $("#btn-cuest-cancelar").addEventListener("click", () => { $("#cuest-editor").hidden = true; });
  $("#btn-cuest-guardar").addEventListener("click", () => guardarCuestionarioTexto($("#cuest-texto").value));
  $("#btn-cuest-descargar").addEventListener("click", () => {
    if (!config.cuestionario) { tostada("Todavía no hay cuestionario cargado."); return; }
    descargar(JSON.stringify(config.cuestionario, null, 2), "cuestionario.json", "application/json");
  });

  // WhatsApp, edición y visor
  $("#wa-enviar").addEventListener("click", enviarWhatsApp);
  $("#wa-ir-config").addEventListener("click", () => { $("#dlg-whatsapp").close(); $("#dlg-ficha").close(); cambiarTab("configuracion"); $("#ent-fecha").focus(); });
  $("#form-editar").addEventListener("submit", guardarEdicion);
  $("#visor-mas").addEventListener("click", () => zoom(+0.5));
  $("#visor-menos").addEventListener("click", () => zoom(-0.5));
  $("#visor-descargar").addEventListener("click", () => {
    if (!visorActual) return;
    // Descarga la página que está más visible en pantalla
    const imgs = $$("#visor-lienzo img");
    const arriba = $("#visor-lienzo").getBoundingClientRect().top;
    let i = imgs.findIndex(im => im.getBoundingClientRect().bottom > arriba + 80);
    if (i < 0) i = visorActual.indice;
    descargarURL(cvCache[visorActual.id].imagenes[i], nombreArchivoCV(visorActual.id, i));
  });
}

function cambiarTab(tab) {
  $$(".a-tab").forEach(t => { const a = t.dataset.tab === tab; t.classList.toggle("activo", a); t.setAttribute("aria-selected", String(a)); });
  $("#tab-postulantes").hidden = tab !== "postulantes";
  $("#tab-configuracion").hidden = tab !== "configuracion";
  window.scrollTo(0, 0);
}

// =====================================================================
//  Filtros
// =====================================================================
const OPC_SINO = ["Sí", "No"];
const FILTROS = [
  { id: "estado", etiqueta: "Estado", opciones: ESTADOS, valor: p => p.estado },
  { id: "sucursal", etiqueta: "Sucursal", opciones: ["Caseros", "Munro", "Indistinto"], valor: p => p.sucursal },
  { id: "puesto", etiqueta: "Puesto", dinamico: true, valor: p => p.puesto },
  { id: "experiencia", etiqueta: "Experiencia", opciones: OPC_SINO, valor: p => siNo(p.experiencia) },
  { id: "sexo", etiqueta: "Sexo", opciones: ["Masculino", "Femenino", "Prefiero no decirlo"], valor: p => p.sexo },
  { id: "edad", etiqueta: "Edad", opciones: ["18 a 25", "26 a 35", "36 a 45", "46 o más"], valor: p => rangoEdad(edad(p.fechaNacimiento)) },
  { id: "estadoCivil", etiqueta: "Estado civil", opciones: ["Soltero/a", "Casado/a", "Divorciado/a", "Viudo/a", "Prefiero no decirlo"], valor: p => p.estadoCivil },
  { id: "licencia", etiqueta: "Licencia de conducir", opciones: OPC_SINO, valor: p => siNo(p.licencia) },
  { id: "confiabilidad", etiqueta: "Confiabilidad", opciones: ["Alto", "Medio", "Bajo"], valor: p => p._perfil?.confiabilidad }
];
function rangoEdad(e) {
  if (e === "" || e == null) return "";
  return e <= 25 ? "18 a 25" : e <= 35 ? "26 a 35" : e <= 45 ? "36 a 45" : "46 o más";
}
const UMBRALES = [30, 40, 50, 60, 70, 80, 90];

function pintarFiltros() {
  const sel = (id, etiqueta, opciones) => `
    <div><label for="f-${id}">${esc(etiqueta)}</label>
      <select id="f-${id}" data-filtro="${id}" class="${filtros[id] ? "activo" : ""}">
        <option value="">Todos</option>
        ${opciones.map(o => `<option value="${esc(o.v ?? o)}" ${String(filtros[id]) === String(o.v ?? o) ? "selected" : ""}>${esc(o.t ?? o)}</option>`).join("")}
      </select></div>`;

  let html = FILTROS.map(f => {
    const opciones = f.dinamico ? [...new Set(postulaciones.map(f.valor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")) : f.opciones;
    return sel(f.id, f.etiqueta, opciones);
  }).join("");
  const umbral = UMBRALES.map(u => ({ v: u, t: `${u}% o más` }));
  html += sel("general", "Puntaje general", umbral);
  $("#grilla-filtros").innerHTML = html;

  $$("[data-filtro]", $("#grilla-filtros")).forEach(s => s.addEventListener("change", () => {
    if (s.value) filtros[s.dataset.filtro] = s.value; else delete filtros[s.dataset.filtro];
    s.classList.toggle("activo", !!s.value);
    pintarLista();
  }));
  const n = Object.keys(filtros).length;
  $("#contador-filtros").textContent = n;
  $("#contador-filtros").hidden = !n;
}

function filtrar() {
  const q = normalizar($("#buscar").value);
  const qDigitos = q.replace(/\D/g, "");
  return postulaciones.filter(p => {
    if (q) {
      const texto = normalizar(`${p.nombre} ${p.apellido} ${p.apellido} ${p.nombre} ${p.numero}`);
      const okTexto = q.split(/\s+/).every(t => texto.includes(t));
      const okDni = qDigitos.length >= 3 && String(p.dni || "").includes(qDigitos);
      if (!okTexto && !okDni) return false;
    }
    for (const f of FILTROS) if (filtros[f.id] && f.valor(p) !== filtros[f.id]) return false;
    if (filtros.general && !((p._perfil?.general ?? -1) >= Number(filtros.general))) return false;
    return true;
  });
}

function ordenar(lista) {
  const o = $("#ordenar").value || "fecha-desc";
  const [campo, dir] = o.split("-");
  const signo = dir === "asc" ? 1 : -1;
  const valor = p => {
    if (campo === "fecha") return p.fechaEnvio || 0;
    if (campo === "remu") return p.remuneracion ?? null;
    if (campo === "general") return p._perfil?.general ?? null;
    return p._perfil?.rasgos[campo] ?? null;
  };
  return [...lista].sort((a, b) => {
    const va = valor(a), vb = valor(b);
    if (va == null && vb == null) return (b.fechaEnvio || 0) - (a.fechaEnvio || 0);
    if (va == null) return 1;           // los que no indicaron van al final
    if (vb == null) return -1;
    return (va - vb) * signo || (b.fechaEnvio || 0) - (a.fechaEnvio || 0);
  });
}

const nivelPuntaje = n => (n >= 70 ? "alto" : n >= 50 ? "medio" : "bajo");
const iniciales = p => `${(p.nombre || "?").trim()[0] || ""}${(p.apellido || "").trim()[0] || ""}`.toUpperCase();

// Indicadores de arriba: tocar uno filtra por ese estado
function pintarKPIs() {
  const cuenta = e => postulaciones.filter(p => p.estado === e).length;
  const kpis = [
    { estado: "", t: "Total", v: postulaciones.length },
    { estado: "Nuevo", t: "Nuevas", v: cuenta("Nuevo"), destacado: true },
    { estado: "Preseleccionado", t: "Preseleccionados", v: cuenta("Preseleccionado") },
    { estado: "Entrevista", t: "En entrevista", v: cuenta("Entrevista") },
    { estado: "Contratado", t: "Contratados", v: cuenta("Contratado") }
  ];
  $("#kpis").innerHTML = kpis.map(k => `
    <button type="button" class="kpi ${k.destacado ? "kpi--destacado" : ""} ${k.estado && filtros.estado === k.estado ? "activo" : ""}" data-estado="${k.estado}" aria-pressed="${!!k.estado && filtros.estado === k.estado}">
      <span class="kpi__etiqueta">${k.t}</span>
      <span class="kpi__valor">${k.v}</span>
    </button>`).join("");
  $$(".kpi", $("#kpis")).forEach(b => b.addEventListener("click", () => {
    const e = b.dataset.estado;
    if (!e || filtros.estado === e) delete filtros.estado; else filtros.estado = e;
    pintarFiltros();
    pintarLista();
  }));
}

let listaAnimada = false;
function pintarLista() {
  pintarKPIs();
  const lista = ordenar(filtrar());
  const total = postulaciones.length;
  $("#resultado").textContent = total === 0 ? "" : lista.length === total ? `${total} postulaciones` : `${lista.length} de ${total} postulaciones`;
  const n = Object.keys(filtros).length;
  $("#contador-filtros").textContent = n;
  $("#contador-filtros").hidden = !n;
  $(".lista-cabeza").hidden = !lista.length;

  if (!lista.length) {
    $("#lista").innerHTML = total
      ? `<div class="vacio"><strong>Sin resultados</strong>No hay postulaciones con estos filtros.</div>`
      : `<div class="vacio"><strong>Todavía no hay postulaciones</strong>Cuando alguien complete el formulario, va a aparecer acá.</div>`;
    return;
  }
  // La entrada escalonada solo la primera vez (no en cada búsqueda)
  const animar = !listaAnimada;
  listaAnimada = true;
  $("#lista").innerHTML = lista.map((p, i) => {
    const pf = p._perfil;
    return `
    <button class="fila ${p.estado === "Nuevo" ? "fila--nuevo" : ""}" data-id="${esc(p.id)}" type="button" style="${animar ? `animation-delay:${Math.min(i, 14) * 28}ms` : "animation:none"}">
      <span class="fila__persona">
        <span class="avatar" aria-hidden="true">${esc(iniciales(p))}</span>
        <span><strong>${esc(p.apellido)}, ${esc(p.nombre)}</strong><small>${esc(p.numero || "")} · ${fechaCorta(p.fechaEnvio)}</small></span>
      </span>
      <span class="fila__puesto">
        <span>${esc(p.puesto)}</span>
        <small>Suc. ${esc(p.sucursal)} · ${esc(p.localidad)} · Exp. ${siNo(p.experiencia)}</small>
      </span>
      <span class="fila__afinidad">
        ${pf ? `<span class="medidor medidor--${nivelPuntaje(pf.general)}" aria-hidden="true"><i style="width:${pf.general}%"></i></span><b title="Puntaje general de afinidad">${pf.general}</b>` : `<small>—</small>`}
      </span>
      <span class="fila__conf">${pf ? `<span class="conf conf-${pf.confiabilidad}">${CONF_TXT[pf.confiabilidad][0].toUpperCase() + CONF_TXT[pf.confiabilidad].slice(1)}</span>` : ""}</span>
      <span class="fila__estado"><span class="etiqueta-estado est-${esc(p.estado)}">${esc(p.estado)}</span></span>
    </button>`;
  }).join("");
  $$(".fila", $("#lista")).forEach(b => b.addEventListener("click", () => abrirFicha(b.dataset.id)));
}

// =====================================================================
//  Ficha del postulante
// =====================================================================
function abrirFicha(id) {
  fichaAbierta = id;
  pintarFicha(id);
  const d = $("#dlg-ficha");
  if (!d.open) d.showModal();
  $("#ficha-cuerpo").scrollTop = 0;
  cargarCV(id);
}

function radarSVG(rasgos) {
  const nombres = nombresRasgos();
  const cortos = { AUT: "Autonomía", HON: "Honestidad", NOR: "Normas", PRO: "Proactividad", DES: "Desacuerdos" };
  const cx = 140, cy = 130, R = 88, n = RASGOS.length;
  const punto = (i, f) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  const poligono = f => RASGOS.map((_, i) => punto(i, f).join(",")).join(" ");
  let s = `<svg class="radar" viewBox="-50 0 380 260" role="img" aria-label="Gráfico de perfil: ${RASGOS.map(r => `${nombres[r]} ${rasgos[r]}%`).join(", ")}">`;
  for (const f of [0.25, 0.5, 0.75, 1]) s += `<polygon class="radar__grilla" points="${poligono(f)}"/>`;
  RASGOS.forEach((_, i) => { const [x, y] = punto(i, 1); s += `<line class="radar__eje" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; });
  const datos = RASGOS.map((r, i) => punto(i, Math.max(0.02, rasgos[r] / 100)).join(",")).join(" ");
  s += `<g class="radar__datos"><polygon points="${datos}"/>`;
  RASGOS.forEach((r, i) => { const [x, y] = punto(i, Math.max(0.02, rasgos[r] / 100)); s += `<circle class="radar__punto" cx="${x}" cy="${y}" r="3.5"/>`; });
  s += `</g>`;
  RASGOS.forEach((r, i) => {
    const [x, y] = punto(i, 1.2);
    const ancla = Math.abs(x - cx) < 5 ? "middle" : x > cx ? "start" : "end";
    s += `<text x="${x}" y="${y + 4}" text-anchor="${ancla}">${cortos[r]} ${rasgos[r]}%</text>`;
  });
  return s + "</svg>";
}

function pintarFicha(id) {
  const p = postulaciones.find(x => x.id === id);
  if (!p) { $("#dlg-ficha").close(); return; }
  const pf = p._perfil;
  const nombres = nombresRasgos();
  $("#ficha-nombre").textContent = `${p.nombre} ${p.apellido}`;
  $("#ficha-avatar").textContent = iniciales(p);
  // Si se vuelve a pintar la misma ficha (por un cambio de datos), sin animaciones de entrada
  $("#ficha-cuerpo").classList.toggle("sin-animacion", $("#ficha-cuerpo").dataset.id === id);
  $("#ficha-cuerpo").dataset.id = id;
  $("#ficha-sub").textContent = `${p.numero || ""} · Enviada el ${fechaHora(p.fechaEnvio)}`;

  const notasPrevias = $("#notas-texto")?.dataset.id === id ? $("#notas-texto").value : null;
  const verResp = $("#bloque-respuestas") && !$("#bloque-respuestas").hidden;
  const fila = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  const empleo = p.primerEmpleo ? "Primer empleo" : `${esc(p.ultimoPuesto || "—")} en ${esc(p.ultimoLugar || "—")}${p.antiguedad ? ` · ${esc(p.antiguedad)}` : ""}`;

  $("#ficha-cuerpo").innerHTML = `
    <section class="seccion">
      <div class="acciones-ficha">
        <label class="oculto-visual" for="ficha-estado">Estado</label>
        <select id="ficha-estado">${ESTADOS.map(e => `<option ${e === p.estado ? "selected" : ""}>${e}</option>`).join("")}</select>
        <button class="btn btn--whatsapp btn--chico" id="btn-invitar" type="button"><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z"/></svg>Invitar por WhatsApp</button>
        <button class="btn btn--secundario btn--chico" id="btn-editar" type="button">Editar datos</button>
      </div>
      ${p.fechaContacto ? `<p class="campo__ayuda">Contactado el ${fechaHora(p.fechaContacto)}</p>` : ""}
    </section>

    <section class="seccion seccion--perfil">
      <h3>Perfil <span class="leyenda">Herramienta orientativa para priorizar entrevistas.</span></h3>
      ${pf ? `
        ${pf.confiabilidad === "Bajo" ? `<div class="aviso aviso--alerta"><strong>Respuestas poco confiables, verificar en entrevista.</strong></div>` : ""}
        <div class="perfil">
          ${radarSVG(pf.rasgos)}
          <div>
            <div class="barras">
              ${RASGOS.map(r => `<div class="barra-rasgo"><span>${esc(nombres[r])}</span><span>${pf.rasgos[r]}%</span><i><b style="width:${pf.rasgos[r]}%"></b></i></div>`).join("")}
            </div>
            <div class="general">
              <div><span class="general__etiqueta">Afinidad general</span><strong>${pf.general}<small>%</small></strong></div>
              <span class="conf conf-${pf.confiabilidad}">Confiabilidad ${CONF_TXT[pf.confiabilidad]}</span>
            </div>
            <p class="perfil__detalle">Contradicciones: ${pf.contradicciones} · “Verdadero” en sinceridad: ${pf.verdaderos} · Respondidas: ${pf.respondidas}/${pf.total}</p>
          </div>
        </div>
        <button class="btn-texto" id="btn-ver-respuestas" type="button">${verResp ? "Ocultar respuestas" : "Ver respuestas exactas"}</button>
        <div class="respuestas" id="bloque-respuestas" ${verResp ? "" : "hidden"}>
          ${pf.detalle.map(d => `
            <div class="respuesta ${/Contradice|quedar bien/.test(d.nota) ? "respuesta--alerta" : ""}">
              <b><span>${esc(d.id)}</span>${esc(d.texto)}</b>
              <span>${esc(d.letra)}) ${esc(d.respuesta)}</span>
              ${d.nota ? `<em>${esc(d.nota)}</em>` : ""}
            </div>`).join("")}
        </div>` : `<p class="campo__ayuda">No se puede calcular: falta cargar el cuestionario en Configuración.</p>`}
    </section>

    <section class="seccion">
      <h3>Datos personales</h3>
      <dl class="datos">
        ${fila("DNI", esc(p.dni))}
        ${fila("Nacimiento", `${fechaISO(p.fechaNacimiento)} (${edad(p.fechaNacimiento)} años)`)}
        ${fila("Sexo", esc(p.sexo))}
        ${fila("Estado civil", esc(p.estadoCivil))}
        ${fila("Localidad", esc(p.localidad))}
        ${fila("Teléfono", `<a href="https://wa.me/${esc(p.telefono)}" target="_blank" rel="noopener">${esc(telVisible(p.telefono))}</a>`)}
      </dl>
    </section>

    <section class="seccion">
      <h3>Perfil laboral</h3>
      <dl class="datos">
        ${fila("Puesto", esc(p.puesto))}
        ${fila("Experiencia en el puesto", siNo(p.experiencia))}
        ${fila("Trabaja actualmente", p.trabajaActualmente ? `Sí · puede dejarlo: ${esc(p.anticipacion || "—")}` : "No")}
        ${fila(p.trabajaActualmente ? "Trabajo actual" : "Último empleo", empleo)}
        ${fila("Sucursal", esc(p.sucursal))}
        ${fila("Dispuesto/a a trabajar en ambas sucursales", siNo(p.traslado))}
        ${fila("Licencia de conducir", siNo(p.licencia))}
        ${fila("Disponibilidad", esc(p.disponibilidad))}
        ${fila("Estudios", esc(p.estudios))}
        ${fila("Esfuerzo físico", siNo(p.esfuerzoFisico))}
        ${fila("Remuneración pretendida", pesos$(p.remuneracion))}
      </dl>
    </section>

    <section class="seccion">
      <h3>Currículum</h3>
      <div id="cv-admin"><p class="campo__ayuda"><span class="giro" style="display:inline-block;vertical-align:middle;width:14px;height:14px"></span> Cargando…</p></div>
    </section>

    <section class="seccion notas">
      <h3>Notas internas</h3>
      <label for="notas-texto" class="oculto-visual">Notas internas</label>
      <textarea id="notas-texto" data-id="${esc(id)}" maxlength="5000" placeholder="Solo las ve el equipo de selección">${esc(notasPrevias ?? p.notasInternas ?? "")}</textarea>
      <div class="fila-botones"><button class="btn btn--primario btn--chico" id="btn-notas" type="button">Guardar notas</button></div>
    </section>`;

  // Volver a mostrar el CV si ya estaba cargado
  if (cvCache[id]) pintarCVAdmin(id);

  $("#ficha-estado").addEventListener("change", async e => {
    try { await update(ref(db, `postulaciones/${id}`), { estado: e.target.value }); tostada(`Estado: ${e.target.value}`); }
    catch (err) { tostada(mensajeError(err)); }
  });
  $("#btn-notas").addEventListener("click", async () => {
    try { await update(ref(db, `postulaciones/${id}`), { notasInternas: $("#notas-texto").value }); tostada("Notas guardadas"); }
    catch (err) { tostada(mensajeError(err)); }
  });
  $("#btn-invitar").addEventListener("click", () => abrirWhatsApp(id));
  $("#btn-editar").addEventListener("click", () => abrirEdicion(id));
  $("#btn-ver-respuestas")?.addEventListener("click", e => {
    const b = $("#bloque-respuestas");
    b.hidden = !b.hidden;
    e.target.textContent = b.hidden ? "Ver respuestas exactas" : "Ocultar respuestas";
  });
}

// ---------- CV ----------
// Las páginas del CV están en la base de datos (cvs/{id}/pagina-N) como imágenes JPG.
// Se descargan solo al abrir la ficha, para que el listado cargue rápido.
const cvCache = {};   // id -> { imagenes: [dataURL] }
async function cargarCV(id) {
  if (cvCache[id]) { pintarCVAdmin(id); return; }
  try {
    const v = (await get(ref(db, `cvs/${id}`))).val() || {};
    const imagenes = Object.keys(v)
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true }))
      .map(k => v[k])
      .filter(u => typeof u === "string" && u.startsWith("data:image/jpeg;base64,"));
    cvCache[id] = { imagenes };
  } catch (err) {
    console.error(err);
    cvCache[id] = { error: mensajeError(err), imagenes: [] };
  }
  if (fichaAbierta === id) pintarCVAdmin(id);
}
function nombreArchivoCV(id, i) {
  const p = postulaciones.find(x => x.id === id);
  const base = p ? `CV ${p.apellido} ${p.nombre}`.replace(/[\/:*?"<>|]/g, "") : "CV";
  return `${base} - pagina ${i + 1}.jpg`;
}
function pintarCVAdmin(id) {
  const c = cvCache[id];
  const caja = $("#cv-admin");
  if (!caja) return;
  if (c.error) { caja.innerHTML = `<p class="campo__error">${esc(c.error)}</p>`; delete cvCache[id]; return; }
  if (!c.imagenes.length) { caja.innerHTML = `<p class="campo__ayuda">No hay CV guardado (puede que la subida no se haya completado).</p>`; return; }
  caja.innerHTML = `
    <div class="cv-miniaturas">${c.imagenes.map((u, i) => `<button type="button" data-i="${i}" aria-label="Ver página ${i + 1} en grande"><img src="${u}" alt="CV página ${i + 1}"></button>`).join("")}</div>
    <div class="fila-botones"><button class="btn btn--secundario btn--chico" type="button" id="btn-descargar-cv">${c.imagenes.length > 1 ? `Descargar las ${c.imagenes.length} páginas` : "Descargar CV"}</button></div>`;
  $$("button[data-i]", caja).forEach(b => b.addEventListener("click", () => abrirVisor(id, Number(b.dataset.i))));
  $("#btn-descargar-cv").addEventListener("click", () => c.imagenes.forEach((u, i) => setTimeout(() => descargarURL(u, nombreArchivoCV(id, i)), i * 300)));
}
function descargarURL(url, nombre) {
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
}

let zoomActual = 1;
let visorActual = null;
function abrirVisor(id, indice) {
  const c = cvCache[id];
  visorActual = { id, indice };
  zoomActual = 1;
  const lienzo = $("#visor-lienzo");
  lienzo.style.setProperty("--zoom", 1);
  lienzo.innerHTML = c.imagenes.map((u, i) => `<img src="${u}" alt="CV página ${i + 1}" id="visor-img-${i}">`).join("");
  $("#visor-pagina").textContent = `${c.imagenes.length} ${c.imagenes.length === 1 ? "página" : "páginas"}`;
  $("#dlg-visor").showModal();
  setTimeout(() => $(`#visor-img-${indice}`)?.scrollIntoView({ block: "start" }), 50);
}
function zoom(delta) {
  zoomActual = Math.min(3, Math.max(0.5, zoomActual + delta));
  $("#visor-lienzo").style.setProperty("--zoom", zoomActual);
}

// =====================================================================
//  Invitación por WhatsApp
// =====================================================================
function diaTexto(iso) {
  if (!iso) return "[día]";
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}
function armarMensaje(nombre, puesto, ent) {
  const dia = ent?.fecha ? diaTexto(ent.fecha) : "[día]";
  const hora = ent?.hora || "[hora]";
  const lugar = ent?.lugar || "[lugar]";
  return `Hola ${nombre}, ¿cómo estás? Te escribimos de HomePoint. Vimos tu perfil y nos interesa para el puesto de ${minusculaInicial(puesto)}. ` +
    `Queríamos saber si tenés disponibilidad para una entrevista el ${dia} a las ${hora} en ${lugar}. ` +
    `Por favor, confirmanos tu asistencia o tu interés respondiendo este mensaje. ¡Gracias!`;
}
let waId = null;
function abrirWhatsApp(id) {
  const p = postulaciones.find(x => x.id === id);
  waId = id;
  const ent = config.entrevista;
  const completa = ent?.fecha && ent?.hora && ent?.lugar;
  $("#wa-aviso").hidden = !!completa;
  $("#wa-texto").value = armarMensaje(p.nombre.split(" ")[0], p.puesto, ent);
  $("#dlg-whatsapp").showModal();
}
async function enviarWhatsApp() {
  const p = postulaciones.find(x => x.id === waId);
  if (!p) return;
  const texto = $("#wa-texto").value.trim();
  if (/\[(día|hora|lugar)\]/.test(texto) && !confirm("El mensaje todavía tiene datos sin completar ([día], [hora] o [lugar]). ¿Querés abrir WhatsApp igual?")) return;
  // Se abre primero (si no, el navegador puede bloquear la ventana)
  window.open(`https://wa.me/${p.telefono}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  $("#dlg-whatsapp").close();
  try {
    await update(ref(db, `postulaciones/${p.id}`), { estado: "Entrevista", fechaContacto: serverTimestamp() });
    tostada("Estado cambiado a “Entrevista”");
  } catch (err) { tostada(mensajeError(err)); }
}

// =====================================================================
//  Edición de datos (solo administradores)
// =====================================================================
const ED_CAMPOS = [
  { k: "nombre", t: "Nombre", tipo: "texto", req: true },
  { k: "apellido", t: "Apellido", tipo: "texto", req: true },
  { k: "dni", t: "DNI", tipo: "texto", req: true },
  { k: "fechaNacimiento", t: "Fecha de nacimiento", tipo: "fecha", req: true },
  { k: "sexo", t: "Sexo", op: ["Masculino", "Femenino", "Prefiero no decirlo"] },
  { k: "estadoCivil", t: "Estado civil", op: ["Soltero/a", "Casado/a", "Divorciado/a", "Viudo/a", "Prefiero no decirlo"] },
  { k: "localidad", t: "Localidad", tipo: "texto", req: true },
  { k: "telefono", t: "Teléfono", tipo: "texto", req: true },
  { k: "puesto", t: "Puesto", tipo: "texto", req: true },
  { k: "experiencia", t: "Experiencia en el puesto", bool: true },
  { k: "trabajaActualmente", t: "Trabaja actualmente", bool: true },
  { k: "anticipacion", t: "Anticipación", op: ["", "Inmediata", "7 días", "15 días"] },
  { k: "primerEmpleo", t: "Primer empleo", bool: true },
  { k: "ultimoLugar", t: "Último lugar de trabajo", tipo: "texto" },
  { k: "ultimoPuesto", t: "Puesto / tareas", tipo: "texto" },
  { k: "antiguedad", t: "Antigüedad", tipo: "texto" },
  { k: "sucursal", t: "Sucursal", op: ["Caseros", "Munro", "Indistinto"] },
  { k: "traslado", t: "Dispuesto/a a ambas sucursales", bool: true },
  { k: "licencia", t: "Licencia", bool: true },
  { k: "disponibilidad", t: "Disponibilidad", op: ["Mañana", "Tarde", "Completa"] },
  { k: "estudios", t: "Estudios", op: ["Secundario incompleto", "Secundario completo", "Terciario o universitario"] },
  { k: "esfuerzoFisico", t: "Esfuerzo físico", bool: true },
  { k: "remuneracion", t: "Remuneración pretendida ($)", tipo: "numero" }
];
let edId = null;
function abrirEdicion(id) {
  const p = postulaciones.find(x => x.id === id);
  edId = id;
  $("#ed-error").textContent = "";
  $("#ed-campos").innerHTML = ED_CAMPOS.map(c => {
    const v = p[c.k];
    let control;
    if (c.bool) control = `<select id="ed-${c.k}"><option value="true" ${v === true ? "selected" : ""}>Sí</option><option value="false" ${v === false ? "selected" : ""}>No</option></select>`;
    else if (c.op) control = `<select id="ed-${c.k}">${c.op.map(o => `<option value="${esc(o)}" ${o === (v ?? "") ? "selected" : ""}>${esc(o || "—")}</option>`).join("")}</select>`;
    else if (c.tipo === "fecha") control = `<input type="date" id="ed-${c.k}" value="${esc(v || "")}">`;
    else if (c.tipo === "numero") control = `<input type="number" id="ed-${c.k}" min="0" step="1000" value="${esc(v ?? "")}">`;
    else control = `<input type="text" id="ed-${c.k}" value="${esc(c.k === "telefono" ? telVisible(v) : v ?? "")}" maxlength="120">`;
    return `<div class="campo"><label for="ed-${c.k}">${esc(c.t)}</label>${control}</div>`;
  }).join("");
  $("#dlg-editar").showModal();
}
async function guardarEdicion(e) {
  e.preventDefault();
  const p = postulaciones.find(x => x.id === edId);
  if (!p) return;
  const cambios = {};
  for (const c of ED_CAMPOS) {
    const raw = $(`#ed-${c.k}`).value.trim();
    let v;
    if (c.bool) v = raw === "true";
    else if (c.tipo === "numero") v = raw ? Math.round(Number(raw)) : null;
    else v = raw || null;
    if (c.req && v == null) { $("#ed-error").textContent = `Completá “${c.t}”.`; return; }
    if ((p[c.k] ?? null) !== v) cambios[c.k] = v;
  }
  if ("telefono" in cambios) {
    const t = normalizarTelefono(cambios.telefono);
    if (!t) { $("#ed-error").textContent = "Revisá el teléfono (código de área + número)."; return; }
    if (t === p.telefono) delete cambios.telefono; else cambios.telefono = t;
  }
  if ("dni" in cambios && !/^\d{7,8}$/.test(cambios.dni)) { $("#ed-error").textContent = "El DNI debe tener 7 u 8 números."; return; }
  if ("dni" in cambios && postulaciones.some(x => x.id !== p.id && x.dni === cambios.dni)) { $("#ed-error").textContent = "Ya existe otra postulación con ese DNI."; return; }
  if (!Object.keys(cambios).length) { $("#dlg-editar").close(); return; }

  // Se escribe todo junto (si falla algo, no se guarda nada)
  const rutas = {};
  for (const [k, v] of Object.entries(cambios)) rutas[`postulaciones/${p.id}/${k}`] = v;
  rutas[`postulaciones/${p.id}/fechaEdicion`] = serverTimestamp();
  if ("dni" in cambios) { rutas[`dni/${p.dni}`] = null; rutas[`dni/${cambios.dni}`] = p.id; }
  try {
    await update(ref(db), rutas);
    $("#dlg-editar").close();
    tostada("Datos actualizados");
  } catch (err) { $("#ed-error").textContent = mensajeError(err); }
}

// =====================================================================
//  Exportar a Excel (CSV)
// =====================================================================
function exportarCSV() {
  const lista = ordenar(filtrar());
  if (!lista.length) { tostada("No hay postulaciones para exportar."); return; }
  const nombres = nombresRasgos();
  const columnas = [
    ["Número", p => p.numero], ["Fecha de envío", p => fechaHora(p.fechaEnvio)], ["Estado", p => p.estado],
    ["Apellido", p => p.apellido], ["Nombre", p => p.nombre], ["DNI", p => p.dni],
    ["Fecha de nacimiento", p => fechaISO(p.fechaNacimiento)], ["Edad", p => edad(p.fechaNacimiento)],
    ["Sexo", p => p.sexo], ["Estado civil", p => p.estadoCivil], ["Localidad", p => p.localidad],
    ["Teléfono", p => telVisible(p.telefono)], ["Puesto", p => p.puesto],
    ["Experiencia en el puesto", p => siNo(p.experiencia)], ["Trabaja actualmente", p => siNo(p.trabajaActualmente)],
    ["Anticipación", p => p.anticipacion || ""], ["Primer empleo", p => siNo(p.primerEmpleo)],
    ["Último lugar", p => p.ultimoLugar || ""], ["Puesto / tareas", p => p.ultimoPuesto || ""], ["Antigüedad", p => p.antiguedad || ""],
    ["Sucursal", p => p.sucursal], ["Dispuesto/a a ambas sucursales", p => siNo(p.traslado)],
    ["Licencia de conducir", p => siNo(p.licencia)],
    ["Disponibilidad", p => p.disponibilidad], ["Estudios", p => p.estudios], ["Esfuerzo físico", p => siNo(p.esfuerzoFisico)],
    ["Remuneración pretendida", p => p.remuneracion ?? ""],
    ...RASGOS.map(r => [`${nombres[r]} (%)`, p => p._perfil?.rasgos[r] ?? ""]),
    ["Puntaje general (%)", p => p._perfil?.general ?? ""], ["Confiabilidad", p => p._perfil?.confiabilidad ?? ""],
    ["Fecha de contacto", p => (p.fechaContacto ? fechaHora(p.fechaContacto) : "")], ["Notas internas", p => p.notasInternas || ""]
  ];
  const celda = v => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const filas = [columnas.map(c => celda(c[0])).join(";"), ...lista.map(p => columnas.map(c => celda(c[1](p))).join(";"))];
  const hoy = new Date().toISOString().slice(0, 10);
  descargar("﻿" + filas.join("\r\n"), `postulaciones-${hoy}.csv`, "text/csv;charset=utf-8");
  tostada(`Exportadas ${lista.length} postulaciones`);
}

function descargar(contenido, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =====================================================================
//  Configuración
// =====================================================================
function pintarConfiguracion() {
  // Entrevista (no pisar lo que se está escribiendo)
  const ent = config.entrevista || {};
  if (!$("#form-entrevista").contains(document.activeElement)) {
    $("#ent-fecha").value = ent.fecha || "";
    $("#ent-hora").value = ent.hora || "";
    $("#ent-lugar").value = ent.lugar || "";
    $$('input[name="ent-sucursal"]').forEach(r => (r.checked = r.value === ent.sucursal));
    previaEntrevista();
  }

  // Pesos
  if (!$("#form-pesos").contains(document.activeElement)) {
    const pesos = { ...PESOS_DEFECTO, ...(config.pesos || {}) };
    const nombres = nombresRasgos();
    $("#campos-pesos").innerHTML = RASGOS.map(r => `
      <div class="peso"><label for="peso-${r}">${esc(nombres[r])}</label>
      <input type="number" id="peso-${r}" min="0" max="10" step="0.5" value="${pesos[r]}" inputmode="decimal"></div>`).join("");
  }

  // Cuestionario
  const c = config.cuestionario;
  const pregs = c ? (Array.isArray(c.preguntas) ? c.preguntas : Object.values(c.preguntas || {})) : [];
  $("#cuest-estado").innerHTML = c
    ? `Versión <strong>${esc(c.version)}</strong> · ${pregs.length} preguntas (${pregs.filter(p => (p.tipo || "perfil") === "perfil").length} de perfil, ${pregs.filter(p => p.tipo === "espejo").length} espejo, ${pregs.filter(p => p.tipo === "sinceridad").length} de sinceridad)${c.actualizado ? ` · actualizado el ${fechaHora(c.actualizado)}` : ""}`
    : `<span class="campo__error" style="display:inline">Todavía no hay cuestionario cargado. Tocá “Cargar cuestionario.json”.</span>`;
}

function previaEntrevista() {
  const ent = { fecha: $("#ent-fecha").value, hora: $("#ent-hora").value, lugar: $("#ent-lugar").value.trim() };
  $("#ent-previa").textContent = armarMensaje("Juan", SITIO.puestos[0]?.titulo || "depósito", ent);
}

async function guardarEntrevista(e) {
  e.preventDefault();
  const fecha = $("#ent-fecha").value, hora = $("#ent-hora").value, lugar = $("#ent-lugar").value.trim();
  const sucursal = $('input[name="ent-sucursal"]:checked')?.value || "Otro";
  if (!fecha || !hora || !lugar) { $("#ent-error").textContent = "Completá día, hora y lugar."; return; }
  $("#ent-error").textContent = "";
  try {
    await set(ref(db, "configuracion/entrevista"), { fecha, hora, sucursal, lugar });
    okBreve("#ent-ok");
  } catch (err) { $("#ent-error").textContent = mensajeError(err); }
}

async function guardarPesos(e) {
  e.preventDefault();
  const pesos = {};
  for (const r of RASGOS) {
    const v = Number($(`#peso-${r}`).value);
    pesos[r] = isFinite(v) && v >= 0 ? Math.min(v, 10) : 1;
  }
  if (!Object.values(pesos).some(v => v > 0)) { tostada("Al menos un rasgo tiene que pesar más de 0."); return; }
  try { await set(ref(db, "configuracion/pesos"), pesos); okBreve("#pesos-ok"); }
  catch (err) { tostada(mensajeError(err)); }
}

// ---------- Puestos ----------
function pintarPuestosAdmin(listaForzada) {
  const lista = listaForzada || (puestosPublicos ? Object.values(puestosPublicos) : SITIO.puestos.map(p => ({ ...p })));
  $("#lista-puestos-admin").innerHTML = lista.map((p, i) => `
    <div class="puesto-admin" data-i="${i}" data-id="${esc(p.id || "p" + i)}">
      <div><label for="pu-t-${i}">Título</label><input type="text" id="pu-t-${i}" data-k="titulo" value="${esc(p.titulo)}" maxlength="120"></div>
      <div><label for="pu-d-${i}">Descripción (tarjeta de inicio)</label><input type="text" id="pu-d-${i}" data-k="descripcion" value="${esc(p.descripcion || "")}" maxlength="240"></div>
      <div><label for="pu-f-${i}">Frase para la pregunta de experiencia</label><input type="text" id="pu-f-${i}" data-k="frase" value="${esc(p.frase || "")}" maxlength="160" placeholder="depósito, reposición, carga y descarga de mercadería"></div>
      <div>
        <p class="puesto-admin__etiqueta">Sucursales donde se busca</p>
        <div class="puesto-admin__sucursales">
          ${["Caseros", "Munro"].map(s => `<label class="casilla"><input type="checkbox" data-suc="${s}" ${!p.sucursales || p.sucursales[s] === true ? "checked" : ""}><span class="casilla__caja" aria-hidden="true"></span><span>${s}</span></label>`).join("")}
        </div>
      </div>
      <div class="puesto-admin__fila">
        <label class="casilla"><input type="checkbox" data-k="activo" ${p.activo !== false ? "checked" : ""}><span class="casilla__caja" aria-hidden="true"></span><span>Visible para el público</span></label>
        <label class="casilla"><input type="checkbox" data-k="completo" ${p.completo === true ? "checked" : ""}><span class="casilla__caja" aria-hidden="true"></span><span>Búsqueda completa (sello rojo, no se puede elegir)</span></label>
        <button class="btn-texto" type="button" data-quitar="${i}">Eliminar</button>
      </div>
    </div>`).join("") || `<p class="campo__ayuda">No hay puestos. Agregá uno.</p>`;
  $$("[data-quitar]").forEach(b => b.addEventListener("click", () => {
    const l = leerPuestosForm();
    l.splice(Number(b.dataset.quitar), 1);
    pintarPuestosAdmin(l);
  }));
}
function leerPuestosForm() {
  return $$(".puesto-admin").map(div => ({
    id: div.dataset.id,
    titulo: $('[data-k="titulo"]', div).value.trim(),
    descripcion: $('[data-k="descripcion"]', div).value.trim(),
    frase: $('[data-k="frase"]', div).value.trim(),
    activo: $('[data-k="activo"]', div).checked,
    completo: $('[data-k="completo"]', div).checked,
    sucursales: Object.fromEntries($$("[data-suc]", div).map(c => [c.dataset.suc, c.checked]))
  }));
}
async function guardarPuestos() {
  const lista = leerPuestosForm();
  if (lista.some(p => !p.titulo)) { tostada("Cada puesto necesita un título."); return; }
  if (lista.some(p => !p.sucursales.Caseros && !p.sucursales.Munro)) { tostada("Cada puesto necesita al menos una sucursal."); return; }
  try { await set(ref(db, "publico/puestos"), lista); okBreve("#puestos-ok"); }
  catch (err) { tostada(mensajeError(err)); }
}

// ---------- Cuestionario ----------
function sinVersion(c) {
  if (!c) return c;
  const { actualizado, ...resto } = c;
  return resto;
}
async function cargarArchivoCuestionario(e) {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  const texto = await archivo.text();
  $("#cuest-texto").value = texto;
  $("#cuest-editor").hidden = false;
  await guardarCuestionarioTexto(texto);
}
async function guardarCuestionarioTexto(texto) {
  $("#cuest-error").textContent = "";
  let c;
  try { c = JSON.parse(texto); }
  catch (err) { $("#cuest-error").textContent = "El texto no es un JSON válido: " + err.message; return; }
  const errores = revisarCuestionario(c);
  if (errores.length) { $("#cuest-error").innerHTML = "Revisá:<br>" + errores.map(esc).join("<br>"); return; }

  const actual = config.cuestionario;
  // Comparación sin importar el orden de las claves (la base las reordena)
  const estable = o => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
  if (actual && estable(sinVersion({ ...actual, version: 0 })) === estable({ ...c, version: 0 })) {
    tostada("No hay cambios para publicar.");
    $("#cuest-editor").hidden = true;
    return;
  }
  if (actual && !confirm("Vas a publicar una nueva versión del cuestionario. Las postulaciones anteriores se siguen calculando con la versión con la que respondieron. ¿Continuar?")) return;

  // Nueva versión: siempre mayor que la anterior
  const version = actual ? Math.max(Number(actual.version) + 1, Number(c.version) || 0) : Number(c.version) || 1;
  const completo = { ...c, version, actualizado: Date.now() };
  try {
    await update(ref(db), {
      "configuracion/cuestionario": completo,
      [`configuracion/historialCuestionario/v${version}`]: completo,
      "publico/cuestionario": versionPublica(completo)
    });
    $("#cuest-editor").hidden = true;
    okBreve("#cuest-ok");
  } catch (err) { $("#cuest-error").textContent = mensajeError(err); }
}
