// =====================================================================
//  Cálculo del perfil (SOLO lo usa el panel de administración).
//  Las preguntas, opciones y puntajes vienen del cuestionario guardado en
//  la base (configuracion/cuestionario), que se carga desde cuestionario.json.
// =====================================================================

export const RASGOS = ["AUT", "HON", "NOR", "PRO", "DES"];
export const PESOS_DEFECTO = { AUT: 1, HON: 1, NOR: 1, PRO: 1, DES: 1 };

const lista = v => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

/**
 * Calcula el perfil de una persona.
 * Devuelve { rasgos: {AUT: 0-100, ...}, general: 0-100, confiabilidad: "Alto"|"Medio"|"Bajo",
 *            contradicciones, verdaderos, respondidas, detalle: [...] }
 */
export function calcularPerfil(respuestas = {}, cuestionario, pesos = PESOS_DEFECTO) {
  if (!cuestionario) return null;
  const preguntas = lista(cuestionario.preguntas);
  const mapa = Object.fromEntries(preguntas.map(p => [p.id, p]));
  const obtenido = Object.fromEntries(RASGOS.map(r => [r, 0]));
  const maximo = Object.fromEntries(RASGOS.map(r => [r, 0]));
  let contradicciones = 0, verdaderos = 0, respondidas = 0;
  const detalle = [];

  for (const p of preguntas) {
    const opciones = lista(p.opciones);
    const elegida = opciones.find(o => o.id === respuestas[p.id]);
    if (elegida) respondidas++;
    const tipo = p.tipo || "perfil";
    const item = { id: p.id, tipo, texto: p.texto, respuesta: elegida?.texto ?? "Sin respuesta", letra: respuestas[p.id] || "—", nota: "" };

    if (tipo === "perfil") {
      // Máximo posible de cada rasgo en esta pregunta = mejor opción para ese rasgo
      for (const r of RASGOS) {
        const mejor = Math.max(0, ...opciones.map(o => Number(o.puntos?.[r]) || 0));
        if (opciones.some(o => o.puntos && r in o.puntos)) maximo[r] += mejor;
        if (elegida) obtenido[r] += Number(elegida.puntos?.[r]) || 0;
      }
      if (elegida?.puntos) item.nota = Object.entries(elegida.puntos).map(([r, v]) => `${r} ${v}`).join(" · ");
    } else if (tipo === "espejo") {
      const original = respuestas[p.espejoDe];
      const coincide = lista(elegida?.coincideCon);
      if (elegida && original && !coincide.includes(original)) {
        contradicciones++;
        item.nota = `Contradice ${p.espejoDe}`;
      } else if (elegida) item.nota = `Coherente con ${p.espejoDe}`;
    } else if (tipo === "sinceridad") {
      if (elegida?.alerta) { verdaderos++; item.nota = "Posible respuesta para quedar bien"; }
    }
    detalle.push(item);
  }

  const rasgos = {};
  for (const r of RASGOS) rasgos[r] = maximo[r] > 0 ? Math.round((obtenido[r] / maximo[r]) * 100) : 0;

  // Puntaje general: promedio ponderado con los pesos configurados
  let suma = 0, sumaPesos = 0;
  for (const r of RASGOS) {
    const w = Math.max(0, Number(pesos?.[r] ?? 1) || 0);
    suma += rasgos[r] * w;
    sumaPesos += w;
  }
  const general = sumaPesos > 0 ? Math.round(suma / sumaPesos) : 0;

  // Índice de confiabilidad
  const c = cuestionario.confiabilidad || {};
  const penal = contradicciones * (c.puntosPorContradiccion ?? 2) + verdaderos * (c.puntosPorVerdadero ?? 1);
  const confiabilidad = penal >= (c.bajoDesde ?? 4) ? "Bajo" : penal >= (c.medioDesde ?? 2) ? "Medio" : "Alto";

  return { rasgos, general, confiabilidad, contradicciones, verdaderos, respondidas, total: preguntas.length, detalle };
}

/** Versión pública del cuestionario: solo textos, sin puntajes ni tipos. */
export function versionPublica(cuestionario) {
  return {
    version: cuestionario.version,
    preguntas: lista(cuestionario.preguntas).map(p => ({
      id: p.id,
      texto: p.texto,
      mezclarOpciones: p.mezclarOpciones !== false,
      opciones: lista(p.opciones).map(o => ({ id: o.id, texto: o.texto }))
    }))
  };
}

/** Revisa que el cuestionario tenga el formato esperado. Devuelve lista de problemas. */
export function revisarCuestionario(c) {
  const errores = [];
  if (!c || typeof c !== "object") return ["El archivo no tiene un formato válido."];
  const preguntas = lista(c.preguntas);
  if (!preguntas.length) errores.push("No hay preguntas.");
  const ids = new Set();
  for (const p of preguntas) {
    const n = p?.id || "(sin id)";
    if (!/^P[0-9]{1,3}$/.test(p?.id || "")) errores.push(`${n}: el id debe ser P seguido de un número (ej. P7).`);
    if (ids.has(p.id)) errores.push(`${n}: id repetido.`);
    ids.add(p.id);
    if (!p.texto) errores.push(`${n}: falta el texto.`);
    const ops = lista(p.opciones);
    if (ops.length < 2) errores.push(`${n}: necesita al menos 2 opciones.`);
    for (const o of ops) if (!/^[A-Z]$/.test(o?.id || "") || !o.texto) errores.push(`${n}: cada opción necesita un id de una letra mayúscula y un texto.`);
    const tipo = p.tipo || "perfil";
    if (!["perfil", "espejo", "sinceridad"].includes(tipo)) errores.push(`${n}: tipo desconocido "${tipo}".`);
    if (tipo === "espejo" && !p.espejoDe) errores.push(`${n}: falta "espejoDe".`);
    if (tipo === "perfil") for (const o of ops) for (const k of Object.keys(o.puntos || {})) if (!RASGOS.includes(k)) errores.push(`${n}: rasgo desconocido "${k}".`);
  }
  for (const p of preguntas) if (p?.tipo === "espejo" && p.espejoDe && !ids.has(p.espejoDe)) errores.push(`${p.id}: "espejoDe" apunta a una pregunta que no existe.`);
  return [...new Set(errores)];
}
