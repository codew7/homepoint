/*
 * Se inyecta en control.html cuando corre adentro del APK "Control".
 * Expone el gatillo por software del lector incorporado.
 */
(function () {
  'use strict';
  var nativo = window.AppControl;
  if (!nativo || window.__puenteControl) return;
  window.__puenteControl = true;
  window.APP_COLECTOR = true;
  window.dispararLectorColector = function () {
    try { return !!nativo.dispararLector(); } catch (e) { return false; }
  };
  window.tieneLectorColector = function () {
    try { return !!nativo.tieneLector(); } catch (e) { return false; }
  };
  if (typeof window.__puenteListo === 'function') window.__puenteListo();
})();
