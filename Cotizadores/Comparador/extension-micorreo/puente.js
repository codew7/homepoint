// Corre en todas las paginas de MiCorreo (mundo aislado de la extension).
// - En envioCla con el formulario a la vista: toma el envio pendiente del cotizador y se lo pasa a
//   rellenar.js (que corre dentro de la pagina para usar su jQuery, igual que cotizador.py).
// - En cualquier otra pagina (login, inicio): si hay un envio esperando, muestra un aviso con un
//   boton para ir al formulario una vez iniciada la sesion.
(() => {
  const ENVIO_CLA_URL = "https://www.correoargentino.com.ar/MiCorreo/public/envioCla";
  const enEnvioCla = location.hostname === "www.correoargentino.com.ar" && location.pathname.startsWith("/MiCorreo/public/envioCla");

  const enviar = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => res(r || { error: chrome.runtime.lastError?.message || "sin respuesta" })); }
    catch (e) { res({ error: String(e.message || e) }); }
  });

  // ---------- Aviso flotante (shadow DOM: el CSS del sitio no lo toca) ----------
  let caja;
  function aviso(texto, { tono = "info", boton = null, cerrar = true } = {}) {
    if (!caja) {
      const host = document.createElement("div");
      // Abajo a la izquierda: arriba a la derecha tapa el login de MiCorreo y abajo a la derecha, su chat.
      host.style.cssText = "position:fixed; bottom:16px; left:16px; z-index:2147483647";
      document.documentElement.appendChild(host);
      const raiz = host.attachShadow({ mode: "open" });
      raiz.innerHTML = `<style>
        .c { font: 14px/1.4 system-ui, "Segoe UI", sans-serif; background:#1d1b18; color:#f4efe6; border-radius:12px;
             padding:14px 16px; width:320px; box-shadow:0 10px 30px rgba(0,0,0,.35); border-left:5px solid #c9a227; }
        .c.ok { border-left-color:#3f9b5f } .c.err { border-left-color:#d0533f }
        .t { font-weight:600; margin-bottom:4px; color:#c9a227 } .c.ok .t { color:#7fd09a } .c.err .t { color:#f08a78 }
        .b { display:flex; gap:8px; margin-top:10px }
        button { font:inherit; border:0; border-radius:8px; padding:6px 12px; cursor:pointer }
        .p { background:#c9a227; color:#1d1b18; font-weight:600 } .s { background:#3a3631; color:#f4efe6 }
      </style><div class="c"><div class="t">Cotizador de envíos</div><div class="m"></div><div class="b"></div></div>`;
      caja = { host, raiz };
    }
    const c = caja.raiz.querySelector(".c");
    c.className = "c " + tono;
    c.querySelector(".m").textContent = texto;
    const b = c.querySelector(".b"); b.innerHTML = "";
    if (boton) { const x = document.createElement("button"); x.className = "p"; x.textContent = boton.texto; x.onclick = boton.accion; b.appendChild(x); }
    if (cerrar) { const x = document.createElement("button"); x.className = "s"; x.textContent = "Cerrar"; x.onclick = () => { caja.host.remove(); caja = null; }; b.appendChild(x); }
  }

  // ---------- Comunicacion con rellenar.js (mundo de la pagina) ----------
  function paginaLista() {
    return new Promise((res) => {
      const escuchar = (ev) => {
        if (ev.source === window && ev.data && ev.data.fuente === "cotizador-pagina" && ev.data.tipo === "lista") {
          removeEventListener("message", escuchar); res();
        }
      };
      addEventListener("message", escuchar);
      window.postMessage({ fuente: "cotizador-ext", tipo: "hola" }, location.origin);
    });
  }
  function rellenar(encargo) {
    return new Promise((res) => {
      const escuchar = (ev) => {
        const d = ev.data;
        if (ev.source !== window || !d || d.fuente !== "cotizador-pagina") return;
        if (d.tipo === "progreso") aviso(d.texto, { cerrar: false });
        if (d.tipo === "resultado" && d.id === encargo.id) { removeEventListener("message", escuchar); res(d); }
      };
      addEventListener("message", escuchar);
      window.postMessage({ fuente: "cotizador-ext", tipo: "rellenar", encargo }, location.origin);
    });
  }

  async function iniciar() {
    const p = await enviar({ tipo: "pendiente" });
    if (!p || !p.encargo) return;
    const formulario = enEnvioCla && document.querySelector("#largo");
    if (!formulario) {
      // Sin sesion MiCorreo redirige al login; el envio sigue esperando en el cotizador.
      aviso(`Tenés un envío para cargar: ${p.encargo.resumen}. Iniciá sesión en MiCorreo si hace falta y después tocá «Ir al formulario».`,
        { boton: { texto: "Ir al formulario", accion: () => { location.href = ENVIO_CLA_URL; } } });
      return;
    }
    const t = await enviar({ tipo: "tomar", puerto: p.puerto, id: p.encargo.id });
    if (t.error || !t.encargo) return;  // otra pestana ya lo tomo
    aviso("Cargando el envío en el formulario…", { cerrar: false });
    await paginaLista();
    const r = await rellenar(t.encargo);
    await enviar({ tipo: "resultado", puerto: p.puerto, datos: { id: t.encargo.id, ok: r.ok, mensaje: r.mensaje, avisos: r.avisos || [] } });
    if (r.ok) {
      aviso("Listo: revisá los datos, elegí el servicio y seguí con el pago." + (r.avisos && r.avisos.length ? "\n\nOjo: " + r.avisos.join(" ") : ""), { tono: r.avisos && r.avisos.length ? "info" : "ok" });
    } else {
      aviso("No se pudo completar todo el formulario: " + r.mensaje + "\nLo que falte se puede cargar a mano.", { tono: "err" });
    }
  }

  iniciar();
})();
