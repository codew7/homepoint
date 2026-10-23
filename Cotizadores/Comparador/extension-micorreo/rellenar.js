// Corre dentro de la pagina envioCla (world: MAIN) para usar el jQuery del sitio. Completa el
// formulario con los mismos pasos que _completar_formulario / _completar_destinatario de
// ../../Correo/cotizador.py: si cambia un selector de MiCorreo, corregirlo en los dos lados.
(() => {
  const DESTINATARIO = {
    sucursal: { nombre: "#nars2", email: "#correoElectronico2", cod_area: "#codAreaPaqSuc", celular: "#celularPaqSuc" },
    domicilio: { nombre: "#nars", email: "#correoElectronico", cod_area: "#codAreaPaqDom", celular: "#celularPaqDom" },
  };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; };
  async function hasta(cond, ms, que) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      try { if (cond()) return true; } catch (e) { /* todavia no */ }
      await espera(150);
    }
    if (que) throw new Error(`no apareció ${que}`);
    return false;
  }
  const progreso = (texto) => window.postMessage({ fuente: "cotizador-pagina", tipo: "progreso", texto }, location.origin);

  // Como page.fill de Playwright: foco, valor y evento input.
  function escribir(sel, valor) {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`falta el campo ${sel}`);
    el.focus();
    el.value = valor;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Como page.select_option: elige y dispara input + change.
  function elegir(sel, opt) {
    const s = document.querySelector(sel);
    s.value = opt.value; opt.selected = true;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function elegirPorTexto(sel, texto) {
    const opt = Array.from(document.querySelectorAll(`${sel} option`)).find((o) => o.textContent.trim().toUpperCase() === texto);
    if (!opt) throw new Error(`no figura «${texto}» en la lista de provincias`);
    elegir(sel, opt);
  }

  function fijarOrigen(suc) {
    const $ = window.jQuery, $suc = $("#sucursalOrigen");
    if ($suc.find(`option[value="${suc}"]`).length === 0) return `la sucursal de origen ${suc} no está en el listado (quedó la de siempre)`;
    $("#sucursalProvinciaOrigen").val(suc.charAt(0));
    $suc.val(suc).trigger("change");
    return null;
  }

  function elegirSucursalDestino(objetivo) {
    const target = objetivo.trim().toUpperCase();
    const opts = Array.from(document.querySelectorAll("#sucursalDestino2 option")).filter((o) => o.value !== "-1");
    const opt = opts.find((o) => o.className.trim().toUpperCase() === target)
      || opts.find((o) => o.textContent.trim().toUpperCase() === target)
      || opts.find((o) => o.textContent.trim().toUpperCase().startsWith(target))
      || opts.find((o) => o.textContent.trim().toUpperCase().includes(target));
    if (!opt) throw new Error(`no hay sucursal de destino que coincida con «${objetivo}»`);
    opt.selected = true;
    window.jQuery("#sucursalDestino2").trigger("change");
  }

  async function completar(e) {
    const avisos = [];
    await hasta(() => window.jQuery && document.querySelector("#largo"), 20000, "el formulario de MiCorreo");

    if (e.sucursal_origen) { const err = fijarOrigen(e.sucursal_origen); if (err) avisos.push(err + "."); }

    // Paso 1: medidas del paquete
    progreso("Cargando medidas y peso…");
    const medidas = { "#largo": e.largo, "#ancho": e.ancho, "#alto": e.alto, "#peso": e.peso, "#valorContenido": e.valor };
    for (const [sel, v] of Object.entries(medidas)) escribir(sel, v);
    await espera(250);
    // El handler de valorContenido limpia el campo en un setTimeout(0): si algo no quedo, se repite.
    for (const [sel, v] of Object.entries(medidas)) if (document.querySelector(sel).value !== v) { escribir(sel, v); await espera(250); }
    document.querySelector("#next").click();

    // Puede aparecer un modal ofreciendo guardar estas medidas como frecuentes.
    if (await hasta(() => document.querySelector("#exampleModal.show"), 3000)) {
      const cancelar = Array.from(document.querySelectorAll("#exampleModal button")).find((b) => b.textContent.includes("Cancelar"));
      if (cancelar) cancelar.click();
      await hasta(() => !document.querySelector("#exampleModal.show"), 3000);
    }
    await hasta(() => visible("#eDestino"), 15000, "la sección de destino");

    // Paso 2: destino
    progreso("Eligiendo el destino…");
    const tipo = document.querySelector("#tipoEntrega");
    elegir("#tipoEntrega", Array.from(tipo.options).find((o) => o.value === e.entrega));
    if (e.entrega === "domicilio") {
      await hasta(() => visible("#provincia"), 10000, "la provincia");
      elegirPorTexto("#provincia", e.provincia);
      await hasta(() => visible("#cpCpa"), 10000, "el código postal");
      escribir("#cpCpa", String(e.cp || ""));
      document.querySelector("#cpCpa").blur();
    } else {
      await hasta(() => visible("#provincia2"), 10000, "la provincia");
      elegirPorTexto("#provincia2", e.provincia);
      // El sitio carga las sucursales de la provincia via AJAX (/consultarSO).
      await hasta(() => document.querySelectorAll("#sucursalDestino2 option").length > 1, 20000, "la lista de sucursales");
      elegirSucursalDestino(e.sucursal_destino || "");
    }

    // Paso 3: precios (no es fatal si tardan)
    progreso("Esperando los precios de MiCorreo…");
    const hayPrecio = () => ["CLASICO", "EXPRESO", "HOY"].some((id) => { const el = document.getElementById(id); const t = el ? el.textContent.trim() : ""; return t !== "" && t !== "Cargando..."; });
    if (!(await hasta(hayPrecio, 20000))) avisos.push("MiCorreo todavía no mostró los precios.");

    // Paso 4: destinatario (si vino con el pedido)
    const d = e.destinatario || {};
    const campos = { nro_orden: "#nroOpcional", ...DESTINATARIO[e.entrega] };
    for (const [clave, sel] of Object.entries(campos)) {
      const v = String(d[clave] || "").trim();
      if (!v) continue;
      if (await hasta(() => visible(sel), 5000)) escribir(sel, v);
      else window.jQuery(sel).val(v).trigger("input");  // queda cargado aunque el sitio lo muestre despues
      window.jQuery(sel).trigger("change").trigger("blur");
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const destino = document.querySelector("#eDestino");
    if (destino) destino.scrollIntoView({ behavior: "smooth", block: "start" });
    if (visible("#verifi-cpO-cp")) avisos.push("MiCorreo marcó un error en el destino.");
    return avisos;
  }

  let enCurso = false;
  addEventListener("message", async (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || m.fuente !== "cotizador-ext") return;
    if (m.tipo === "hola") { window.postMessage({ fuente: "cotizador-pagina", tipo: "lista" }, location.origin); return; }
    if (m.tipo !== "rellenar" || enCurso) return;
    enCurso = true;
    let r;
    try { r = { ok: true, avisos: await completar(m.encargo) }; }
    catch (err) { r = { ok: false, mensaje: String(err && err.message || err) }; }
    window.postMessage({ fuente: "cotizador-pagina", tipo: "resultado", id: m.encargo.id, ...r }, location.origin);
  });
  window.postMessage({ fuente: "cotizador-pagina", tipo: "lista" }, location.origin);
})();
