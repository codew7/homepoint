/*
 * Shim que se inyecta en pedidosv2.html cuando corre adentro del APK.
 *
 * El HTML no se toca: todo lo que hace falta para que funcione en un WebView se
 * parchea desde aca. Tres cosas que el navegador tiene y el WebView no:
 *   - window.print()  -> se manda el documento al servicio de impresion de Android
 *   - descargar blob  -> el <a download> con blob: no baja nada, se guarda por Android
 *   - navigator.share -> no existe la Web Share API, se usa el menu de compartir nativo
 */
(function () {
  'use strict';

  var nativo = window.AppPedidos;
  if (!nativo || window.__puenteHomePoint) return;
  window.__puenteHomePoint = true;
  window.APP_ANDROID = true;

  var TITULO = 'Pedidos HomePoint';
  var TROZO = 262144;   // 256 KB por llamada: el puente no traga mucho mas de una vez

  // ------------------------------------------------------------ archivos

  // El PDF viaja en base64 partido en pedazos; del otro lado Android lo rearma,
  // lo guarda en Descargas y lo abre, o lo manda al menu de compartir.
  function enviarArchivo(blob, nombre, accion) {
    return new Promise(function (resolver, rechazar) {
      var id = 'a' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var lector = new FileReader();
      lector.onerror = function () { rechazar(new Error('No se pudo leer el archivo')); };
      lector.onload = function () {
        try {
          var b64 = String(lector.result).split(',')[1] || '';
          for (var i = 0; i < b64.length; i += TROZO) {
            nativo.agregarTrozo(id, b64.substr(i, TROZO));
          }
          nativo.terminarArchivo(id, nombre, blob.type || 'application/pdf', accion);
          resolver();
        } catch (e) {
          rechazar(e);
        }
      };
      lector.readAsDataURL(blob);
    });
  }

  // La pagina descarga creando un <a download> con una URL blob y haciendole
  // click. En un WebView ese click no baja nada, asi que lo atajamos antes.
  document.addEventListener('click', function (ev) {
    var destino = ev.target;
    var ancla = destino && destino.closest ? destino.closest('a[download]') : null;
    if (!ancla) return;
    var href = ancla.getAttribute('href') || '';
    if (href.indexOf('blob:') !== 0 && href.indexOf('data:') !== 0) return;

    ev.preventDefault();
    ev.stopPropagation();
    fetch(href)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        return enviarArchivo(blob, ancla.getAttribute('download') || 'documento.pdf', 'guardar');
      })
      .catch(function () { nativo.aviso('No se pudo guardar el archivo'); });
  }, true);

  // ------------------------------------------------------------ compartir

  var compartirOriginal = navigator.share ? navigator.share.bind(navigator) : null;
  try {
    navigator.canShare = function (datos) {
      return !!(datos && datos.files && datos.files.length);
    };
    navigator.share = function (datos) {
      if (!datos || !datos.files || !datos.files.length) {
        if (compartirOriginal) return compartirOriginal(datos);
        return Promise.reject(new Error('Compartir no disponible'));
      }
      var archivo = datos.files[0];
      return enviarArchivo(archivo, archivo.name || 'documento.pdf', 'compartir');
    };
  } catch (e) { /* si no se puede pisar, queda la descarga como estaba */ }

  // ------------------------------------------------------------ portapapeles

  // En WebView navigator.clipboard puede existir y fallar en silencio segun el
  // gesto; el portapapeles de Android siempre responde.
  try {
    var copiar = function (texto) {
      nativo.copiar(String(texto));
      return Promise.resolve();
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText = copiar;
    } else {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: copiar },
        configurable: true
      });
    }
  } catch (e) { /* queda el respaldo con execCommand que ya trae la pagina */ }

  // ------------------------------------------------------------ impresion

  window.print = function () {
    try { nativo.imprimirPantalla(TITULO); } catch (e) { /* nada */ }
  };

  var imprimirOriginal = window.imprimirDocumentoHTML;

  if (typeof imprimirOriginal === 'function') {
    // Camino normal: rotulos, facturas y recibos pasan todos por aca.
    window.imprimirDocumentoHTML = function (html) {
      try {
        nativo.imprimirHtml(html, TITULO);
      } catch (e) {
        imprimirOriginal(html);
      }
    };
  } else {
    // Respaldo por si esa funcion dejara de ser global: se le pone print a
    // cada iframe que se agregue al documento, que es como imprime la pagina.
    var appendChildOriginal = Node.prototype.appendChild;
    Node.prototype.appendChild = function (nodo) {
      var resultado = appendChildOriginal.call(this, nodo);
      try {
        if (nodo && nodo.tagName === 'IFRAME' && nodo.contentWindow) {
          var ventana = nodo.contentWindow;
          ventana.print = function () {
            try {
              nativo.imprimirHtml(
                '<!DOCTYPE html>' + ventana.document.documentElement.outerHTML, TITULO);
            } catch (e) { /* nada */ }
          };
        }
      } catch (e) { /* iframes de otro origen: no se tocan */ }
      return resultado;
    };
  }
})();
