/**
 * Punto de entrada. Inicializa Firebase, engancha las suscripciones en vivo y
 * coordina el render de las vistas.
 */

import { initDb, subscribeProveedores, subscribePagos, subscribeFacturas } from './db.js';
import { refrescarDolar, getDolar } from './cotizacion.js';
import { setProveedores, setPagos, setFacturas, setCargando, suscribir } from './store.js';
import { initProveedores, renderProveedores } from './proveedores.js';
import { initPagos, renderPagos, renderSelectsProveedores } from './pagos.js';
import { initFacturas, renderFacturas, renderSelectsFacturas } from './facturas.js';
import { renderResumen } from './resumen.js';
import { initInformes, renderInformes } from './informes.js';
import { formatearMonto } from './utils.js';

/* ─────────────────────────────── Navegación ─────────────────────────────── */

function initTabs() {
  const tabs = document.querySelectorAll('.tab');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        const activa = t === tab;
        t.classList.toggle('tab--activa', activa);
        t.setAttribute('aria-selected', String(activa));
      });

      document.querySelectorAll('.vista').forEach((vista) => {
        vista.classList.toggle('vista--activa', vista.id === `vista-${tab.dataset.vista}`);
      });
    });
  });
}

/* ─────────────────────────────── Cotización ─────────────────────────────── */

/** Formato compacto para el chip: pesos sin decimales, estilo "$ 1.450". */
function formatoChip(n) {
  return `$ ${Math.round(n).toLocaleString('es-AR')}`;
}

/** Pinta el chip del header con los valores en vivo de bluelytics. */
function renderDolar() {
  const { oficial, blue, error } = getDolar();
  const chip = document.getElementById('chip-dolar');

  document.getElementById('dolar-oficial').textContent = oficial ? formatoChip(oficial) : 's/d';
  document.getElementById('dolar-blue').textContent = blue ? formatoChip(blue) : 's/d';

  // Estado de error solo si además no hay ningún valor previo para mostrar.
  chip.classList.toggle('cotizacion--error', Boolean(error) && !oficial && !blue);
}

/* ──────────────────────────────── Estado ──────────────────────────────── */

function mostrarBanner(mensaje, html = false) {
  const banner = document.getElementById('banner-estado');
  banner[html ? 'innerHTML' : 'textContent'] = mensaje;
  banner.classList.remove('banner--oculto');
}

/** Un único render por cambio de estado: todas las vistas quedan consistentes. */
function renderTodo() {
  renderSelectsProveedores();
  renderSelectsFacturas();
  renderPagos();
  renderFacturas();
  renderProveedores();
  renderResumen();
  renderInformes();
}

/* ─────────────────────────────── Arranque ─────────────────────────────── */

async function main() {
  initTabs();

  try {
    initDb();
  } catch (error) {
    // Config con placeholders: la UI queda visible pero sin datos.
    mostrarBanner(
      `<strong>Falta configurar Firebase.</strong> Completá <code>js/firebase-config.js</code> con las credenciales de tu proyecto y recargá la página.`,
      true
    );
    return;
  }

  initProveedores();
  initPagos();
  initFacturas();
  initInformes();

  suscribir(renderTodo);

  // Cotización en vivo (bluelytics): informativa. Se pinta "…" al toque y se
  // actualiza cuando llega la respuesta; refresca cada 10 minutos. No bloquea el
  // arranque: si falla, el chip muestra "s/d" y la carga sigue siendo manual.
  renderDolar();
  refrescarDolar().then(renderDolar);
  setInterval(() => refrescarDolar().then(renderDolar), 10 * 60 * 1000);

  // A partir de acá Firebase empuja los cambios: no hace falta recargar nada a mano.
  subscribeProveedores(
    (proveedores) => {
      setProveedores(proveedores);
      setCargando(false);
    },
    (error) => mostrarBanner(error.message)
  );

  subscribePagos(
    (pagos) => setPagos(pagos),
    (error) => mostrarBanner(error.message)
  );

  subscribeFacturas(
    (facturas) => setFacturas(facturas),
    (error) => mostrarBanner(error.message)
  );
}

main();
