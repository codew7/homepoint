/**
 * Diálogo de confirmación basado en promesa.
 * Reemplaza a window.confirm(), que bloquea el hilo y no se puede estilar.
 */

const modal = document.getElementById('modal-confirmar');
const tituloEl = document.getElementById('confirmar-titulo');
const mensajeEl = document.getElementById('confirmar-mensaje');
const btnAceptar = document.getElementById('confirmar-aceptar');
const btnCancelar = document.getElementById('confirmar-cancelar');

/**
 * @param {{titulo?: string, mensaje: string, textoAceptar?: string}} opciones
 * @returns {Promise<boolean>} true si el usuario confirmó.
 */
export function confirmar({ titulo = 'Confirmar', mensaje, textoAceptar = 'Confirmar' }) {
  tituloEl.textContent = titulo;
  mensajeEl.textContent = mensaje;
  btnAceptar.textContent = textoAceptar;

  modal.showModal();

  return new Promise((resolve) => {
    const finalizar = (resultado) => {
      btnAceptar.removeEventListener('click', onAceptar);
      btnCancelar.removeEventListener('click', onCancelar);
      modal.removeEventListener('close', onCancelar);
      modal.close();
      resolve(resultado);
    };

    const onAceptar = () => finalizar(true);
    const onCancelar = () => finalizar(false);

    btnAceptar.addEventListener('click', onAceptar);
    btnCancelar.addEventListener('click', onCancelar);
    // Cubre el cierre con Escape.
    modal.addEventListener('close', onCancelar);
  });
}
