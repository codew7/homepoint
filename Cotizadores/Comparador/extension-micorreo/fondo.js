// Habla con el cotizador local (servidor.py). Lo hace el service worker y no la pagina de MiCorreo
// porque el navegador no deja que un sitio publico llame a 127.0.0.1; la extension si (host_permissions).
// 8620 = app instalada, 8613 = comparador de desarrollo.
const PUERTOS = [8620, 8613];
const VERSION = chrome.runtime.getManifest().version;

async function pedir(puerto, ruta, cuerpo) {
  const resp = await fetch(`http://127.0.0.1:${puerto}${ruta}`, cuerpo
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }
    : { cache: "no-store" });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

async function manejar(msg) {
  if (msg.tipo === "pendiente") {
    // El primer cotizador abierto que tenga un envio esperando.
    for (const puerto of PUERTOS) {
      try {
        const r = await pedir(puerto, `/api/micorreo/pendiente?version=${encodeURIComponent(VERSION)}`);
        if (r.encargo) return { puerto, encargo: r.encargo };
      } catch (e) { /* ese cotizador no esta abierto */ }
    }
    return { encargo: null };
  }
  if (msg.tipo === "tomar") return pedir(msg.puerto, "/api/micorreo/tomar", { id: msg.id });
  if (msg.tipo === "resultado") return pedir(msg.puerto, "/api/micorreo/resultado", msg.datos);
  throw new Error("mensaje desconocido");
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  manejar(msg).then(responder, (e) => responder({ error: String(e && e.message || e) }));
  return true;  // respuesta asincronica
});
