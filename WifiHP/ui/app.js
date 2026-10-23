// WiFi Clientes — interfaz. Lee el estado de Python una vez por segundo y anima los
// contadores cuadro a cuadro entre lectura y lectura.

const $ = (s) => document.querySelector(s);
const app = $("#app");
const api = () => window.pywebview.api;

let estado = null;
let leidoEn = 0;          // performance.now() de la ultima lectura (para descontar entre lecturas)
let avisoCerrado = "";    // no volver a mostrar el mismo error si lo cerraron
const filas = new Map();  // mac -> <li>

// --- lectura de estado -------------------------------------------------------------------------

async function leer() {
  try {
    pintar(await api().estado());
  } catch (e) { /* la app se esta cerrando */ }
}

function pintar(e) {
  estado = e;
  leidoEn = performance.now();

  const vista = e.activa ? "encendida" : "apagada";
  if (app.dataset.vista !== vista) {
    app.dataset.vista = vista;
    $(".vista-apagada").setAttribute("aria-hidden", e.activa ? "true" : "false");
    $(".vista-encendida").setAttribute("aria-hidden", e.activa ? "false" : "true");
  }
  app.dataset.ocupado = e.ocupado || "";

  // Boton y textos de la vista apagada
  const sinRed = !e.conexion.ok;
  $("#btn-encender").disabled = sinRed;
  $("#encender-texto").textContent = e.ocupado === "encendiendo" ? "Encendiendo…" : "Activar Wi-Fi para clientes";
  const m = e.cfg.minutos;
  $("#sub-minutos").textContent = m === 1 ? "1 minuto" : `${m} minutos`;

  // Linea de estado de la conexion
  const linea = $("#estado-linea");
  linea.classList.toggle("mal", sinRed);
  $("#estado-texto").textContent = sinRed
    ? "Sin internet: revisá el cable de red"
    : `Internet por ${{ cable: "cable", wifi: "Wi-Fi", otra: "red" }[e.conexion.tipo]}${e.conexion.nombre ? " · " + e.conexion.nombre : ""}`;

  // Avisos
  if (e.error) mostrarAviso(e.error, false);
  else if (e.limitado) mostrarAviso("Modo básico: la red funciona, pero sin cortar por tiempo ni proteger la red del comercio. Abrí la app como administrador.", true);
  else ocultarAviso();

  if (e.activa) {
    if ($("#qr").dataset.clave !== e.clave) {
      $("#qr").innerHTML = e.qr;
      $("#qr").dataset.clave = e.clave;
    }
    $("#dato-ssid").textContent = e.ssid;
    $("#dato-clave").textContent = e.clave;
  }
  pintarClientes(e.activa ? e.clientes : []);
}

// --- avisos ------------------------------------------------------------------------------------

function mostrarAviso(texto, esAviso) {
  if (avisoCerrado === texto) return;
  const a = $("#aviso");
  a.classList.toggle("es-aviso", esAviso);
  $("#aviso-texto").textContent = texto;
  a.hidden = false;
}
function ocultarAviso() { $("#aviso").hidden = true; avisoCerrado = ""; }
$("#aviso-cerrar").addEventListener("click", () => {
  avisoCerrado = $("#aviso-texto").textContent;
  $("#aviso").hidden = true;
});

// --- clientes ----------------------------------------------------------------------------------

const R = 14, CIRC = 2 * Math.PI * R;

function filaNueva(c) {
  const li = document.createElement("li");
  li.className = "cliente";
  li.innerHTML = `
    <svg class="anillo" viewBox="0 0 34 34" aria-hidden="true">
      <circle class="pista" cx="17" cy="17" r="${R}"/>
      <circle class="progreso" cx="17" cy="17" r="${R}" stroke-dasharray="${CIRC}"/>
    </svg>
    <div class="cliente-info">
      <div class="cliente-nombre"></div>
      <div class="cliente-detalle"></div>
    </div>
    <span class="tiempo"></span>
    <button class="cortar">Cortar</button>`;
  li.querySelector(".cortar").addEventListener("click", async () => {
    li.querySelector(".cortar").disabled = true;
    pintar(await api().cortar(c.mac));
  });
  return li;
}

function pintarClientes(lista) {
  const ul = $("#lista");
  const vistos = new Set();
  lista.forEach((c, i) => {
    vistos.add(c.mac);
    let li = filas.get(c.mac);
    if (!li) { li = filaNueva(c); filas.set(c.mac, li); }
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
    li.dataset.estado = c.estado;
    li.classList.toggle("fin", c.estado !== "activo");
    li.querySelector(".cliente-nombre").textContent = c.nombre;
    li.querySelector(".cliente-detalle").textContent =
      c.estado === "activo" ? "Con internet" : c.estado === "vencido" ? "Se terminó su tiempo" : "Cortado";
    li.querySelector(".cortar").hidden = c.estado !== "activo";
  });
  for (const [mac, li] of filas) {
    if (vistos.has(mac)) continue;
    filas.delete(mac);
    li.classList.add("saliendo");
    li.addEventListener("animationend", () => li.remove(), { once: true });
  }
  const activos = lista.filter((c) => c.estado === "activo").length;
  $("#contador").textContent = activos;
  $("#vacio").hidden = lista.length > 0;
}

function reloj(seg) {
  const s = Math.ceil(seg);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Contadores fluidos: descontar el tiempo desde la ultima lectura.
function cuadro() {
  if (estado && estado.activa) {
    const pasado = (performance.now() - leidoEn) / 1000;
    for (const c of estado.clientes) {
      const li = filas.get(c.mac);
      if (!li) continue;
      const tiempo = li.querySelector(".tiempo");
      if (c.estado !== "activo") {
        tiempo.textContent = "";
        continue;
      }
      const resta = Math.max(0, c.restante - pasado);
      tiempo.textContent = reloj(resta);
      li.classList.toggle("poco", resta <= 60);
      li.querySelector(".progreso").style.strokeDashoffset = CIRC * (1 - resta / c.total);
    }
  }
  requestAnimationFrame(cuadro);
}

// --- acciones ----------------------------------------------------------------------------------

$("#btn-encender").addEventListener("click", async () => {
  avisoCerrado = "";
  app.dataset.ocupado = "encendiendo";          // respuesta inmediata, sin esperar a Windows
  $("#encender-texto").textContent = "Encendiendo…";
  pintar(await api().activar());
});
$("#btn-apagar").addEventListener("click", async () => {
  app.dataset.ocupado = "apagando";
  pintar(await api().apagar());
});
$("#btn-minimizar").addEventListener("click", () => api().minimizar());
$("#btn-cerrar").addEventListener("click", () => api().cerrar());

// --- ajustes -----------------------------------------------------------------------------------

const hoja = $("#hoja"), velo = $("#velo");
let borrador = null;

function abrirAjustes() {
  if (!estado) return;
  borrador = { ...estado.cfg };
  $("#in-ssid").value = borrador.ssid;
  $("#in-minutos").textContent = borrador.minutos;
  marcarAuto();
  $("#hoja-nota").hidden = !estado.activa;
  velo.hidden = hoja.hidden = false;
  velo.classList.remove("saliendo"); hoja.classList.remove("saliendo");
  setTimeout(() => $("#in-ssid").focus(), 50);
}
function cerrarAjustes() {
  if (hoja.hidden) return;
  velo.classList.add("saliendo"); hoja.classList.add("saliendo");
  hoja.addEventListener("animationend", () => { velo.hidden = hoja.hidden = true; }, { once: true });
}
function marcarAuto() {
  const opciones = [5, 15, 0];
  const valor = opciones.includes(borrador.apagado_auto_min) ? borrador.apagado_auto_min : 5;
  for (const b of $("#in-auto").children) b.setAttribute("aria-checked", String(+b.dataset.valor === valor));
}

$("#btn-ajustes").addEventListener("click", abrirAjustes);
velo.addEventListener("click", cerrarAjustes);
$("#btn-hoja-cancelar").addEventListener("click", cerrarAjustes);
document.querySelectorAll(".paso-btn").forEach((b) => b.addEventListener("click", () => {
  borrador.minutos = Math.min(120, Math.max(1, borrador.minutos + +b.dataset.paso));
  $("#in-minutos").textContent = borrador.minutos;
}));
$("#in-auto").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  borrador.apagado_auto_min = +b.dataset.valor;
  marcarAuto();
});
$("#btn-hoja-guardar").addEventListener("click", async () => {
  borrador.ssid = $("#in-ssid").value.trim() || estado.cfg.ssid;
  pintar(await api().guardar_config(borrador));
  cerrarAjustes();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") cerrarAjustes();
  if (ev.key === "Enter" && !hoja.hidden && ev.target.tagName === "INPUT") $("#btn-hoja-guardar").click();
});

// --- arranque ----------------------------------------------------------------------------------

window.addEventListener("pywebviewready", () => {
  leer();
  setInterval(leer, 1000);
  requestAnimationFrame(cuadro);
});
document.addEventListener("contextmenu", (ev) => {
  if (ev.target.tagName !== "INPUT") ev.preventDefault();
});
