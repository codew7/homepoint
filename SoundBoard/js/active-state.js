// Estado activo/inactivo de cada audio, guardado sólo en este navegador
// (localStorage). Cada equipo decide qué audios suenan sin afectar a los demás.
// Si un audio no tiene valor guardado, se usa el `isActive` que viene de la DB.

const KEY = 'sb_active_states';

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const states = load();

export function applyActiveStates(audios) {
  return audios.map(a => (a.id in states ? { ...a, isActive: states[a.id] } : a));
}

export function setActiveState(id, isActive) {
  states[id] = !!isActive;
  try {
    localStorage.setItem(KEY, JSON.stringify(states));
  } catch {
    // Sin almacenamiento disponible: el cambio vale hasta recargar la página.
  }
}

export function forgetActiveState(id) {
  if (!(id in states)) return;
  delete states[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(states));
  } catch {}
}
