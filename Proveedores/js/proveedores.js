/** Vista de proveedores: listado, alta, edición y baja lógica. */

import { crearProveedor, actualizarProveedor, darDeBajaProveedor, reactivarProveedor } from './db.js';
import { getState, getProveedorPorId, setVerInactivos, calcularTotales } from './store.js';
import { formatearMonto, escaparHtml, mostrarToast, marcarError, limpiarErrores } from './utils.js';
import { confirmar } from './confirmar.js';

const modal = document.getElementById('modal-proveedor');
const form = document.getElementById('form-proveedor');
const tbody = document.getElementById('tbody-proveedores');
const vacio = document.getElementById('proveedores-vacio');

/* ──────────────────────────────── Render ──────────────────────────────── */

export function renderProveedores() {
  const state = getState();
  const visibles = state.verInactivos
    ? state.proveedores
    : state.proveedores.filter((p) => p.activo !== false);

  vacio.classList.toggle('vacio--oculto', visibles.length > 0);
  vacio.textContent = state.proveedores.length
    ? 'No hay proveedores activos. Marcá "Ver dados de baja" para ver el resto.'
    : 'Todavía no cargaste proveedores.';

  tbody.innerHTML = visibles
    .map((proveedor) => {
      const activo = proveedor.activo !== false;
      const totales = calcularTotales(state.pagos.filter((p) => p.proveedorId === proveedor.id));

      return `
        <tr class="${activo ? '' : 'fila--inactiva'}">
          <td>
            ${escaparHtml(proveedor.nombre)}
            ${activo ? '' : '<span class="chip chip--baja">Baja</span>'}
          </td>
          <td>${escaparHtml(proveedor.cuit) || '<span class="texto-suave">—</span>'}</td>
          <td>${escaparHtml(proveedor.telefono) || '<span class="texto-suave">—</span>'}</td>
          <td class="num">${formatearMonto(totales.equivalenteARS, 'ARS')}</td>
          <td>
            <div class="acciones">
              <button type="button" class="btn-icono" data-editar="${proveedor.id}">Editar</button>
              ${activo
                ? `<button type="button" class="btn-icono btn-icono--peligro" data-baja="${proveedor.id}">Dar de baja</button>`
                : `<button type="button" class="btn-icono" data-reactivar="${proveedor.id}">Reactivar</button>`}
            </div>
          </td>
        </tr>`;
    })
    .join('');
}

/* ──────────────────────────────── Modal ──────────────────────────────── */

function abrirModal(proveedor = null) {
  form.reset();
  limpiarErrores(form);

  document.getElementById('titulo-modal-proveedor').textContent = proveedor
    ? 'Editar proveedor'
    : 'Nuevo proveedor';
  document.getElementById('proveedor-id').value = proveedor?.id || '';
  document.getElementById('proveedor-nombre').value = proveedor?.nombre || '';
  document.getElementById('proveedor-cuit').value = proveedor?.cuit || '';
  document.getElementById('proveedor-telefono').value = proveedor?.telefono || '';
  document.getElementById('proveedor-notas').value = proveedor?.notas || '';

  modal.showModal();
  document.getElementById('proveedor-nombre').focus();
}

/**
 * Valida el formulario y devuelve los datos limpios, o null si hay errores.
 */
function validarFormulario() {
  limpiarErrores(form);
  let valido = true;

  const nombreInput = document.getElementById('proveedor-nombre');
  const cuitInput = document.getElementById('proveedor-cuit');

  const nombre = nombreInput.value.trim();
  const cuit = cuitInput.value.trim();

  if (!nombre) {
    marcarError(nombreInput, 'El nombre es obligatorio.');
    valido = false;
  }

  // El CUIT es opcional, pero si se carga no puede repetirse (se comparan solo dígitos).
  if (cuit) {
    const idActual = document.getElementById('proveedor-id').value;
    const soloDigitos = (v) => (v || '').replace(/\D/g, '');
    const duplicado = getState().proveedores.find(
      (p) => p.id !== idActual && soloDigitos(p.cuit) === soloDigitos(cuit) && soloDigitos(cuit)
    );
    if (duplicado) {
      marcarError(cuitInput, `Ese CUIT ya está registrado en "${duplicado.nombre}".`);
      valido = false;
    }
  }

  if (!valido) return null;

  return {
    nombre,
    cuit,
    telefono: document.getElementById('proveedor-telefono').value.trim(),
    notas: document.getElementById('proveedor-notas').value.trim(),
  };
}

async function guardar(event) {
  event.preventDefault();

  const datos = validarFormulario();
  if (!datos) return;

  const boton = document.getElementById('btn-guardar-proveedor');
  const id = document.getElementById('proveedor-id').value;

  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    if (id) {
      await actualizarProveedor(id, datos);
      mostrarToast('Proveedor actualizado.', 'exito');
    } else {
      await crearProveedor(datos);
      mostrarToast('Proveedor creado.', 'exito');
    }
    modal.close();
  } catch (error) {
    mostrarToast(error.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar proveedor';
  }
}

/* ─────────────────────────────── Acciones ─────────────────────────────── */

async function pedirBaja(id) {
  const proveedor = getProveedorPorId(id);
  if (!proveedor) return;

  const cantidadPagos = getState().pagos.filter((p) => p.proveedorId === id).length;

  const ok = await confirmar({
    titulo: 'Dar de baja',
    mensaje: `Se va a dar de baja a "${proveedor.nombre}". Sus ${cantidadPagos} pago(s) se conservan en el historial y podés reactivarlo cuando quieras.`,
    textoAceptar: 'Dar de baja',
  });
  if (!ok) return;

  try {
    await darDeBajaProveedor(id);
    mostrarToast('Proveedor dado de baja.', 'exito');
  } catch (error) {
    mostrarToast(error.message, 'error');
  }
}

async function reactivar(id) {
  try {
    await reactivarProveedor(id);
    mostrarToast('Proveedor reactivado.', 'exito');
  } catch (error) {
    mostrarToast(error.message, 'error');
  }
}

/* ────────────────────────────── Inicialización ────────────────────────────── */

export function initProveedores() {
  document.getElementById('btn-nuevo-proveedor').addEventListener('click', () => abrirModal());
  form.addEventListener('submit', guardar);

  modal.querySelectorAll('[data-cerrar]').forEach((btn) =>
    btn.addEventListener('click', () => modal.close())
  );

  document.getElementById('ver-inactivos').addEventListener('change', (e) =>
    setVerInactivos(e.target.checked)
  );

  // Delegación: las filas se redibujan en cada cambio, no conviene atar listeners a cada botón.
  tbody.addEventListener('click', (event) => {
    const boton = event.target.closest('button');
    if (!boton) return;

    if (boton.dataset.editar) abrirModal(getProveedorPorId(boton.dataset.editar));
    else if (boton.dataset.baja) pedirBaja(boton.dataset.baja);
    else if (boton.dataset.reactivar) reactivar(boton.dataset.reactivar);
  });
}
