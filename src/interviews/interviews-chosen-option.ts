/**
 * FR-009 (spec 012). Responde una sola pregunta: ¿este texto es una de las
 * opciones que se le propusieron a esta pregunta, sin editar?
 *
 * Existe para envolver a `esAsentimientoVacio`, no para reemplazarlo: el
 * sistema no puede proponer una opción y después objetar que la elijan. Una
 * opción propuesta y enviada tal cual nunca dispara repregunta, aunque sea
 * corta y aunque contenga muletillas. Todo lo demás —texto libre, u opción
 * editada— sigue pasando por la heurística de siempre.
 *
 * ⚠️ La normalización es deliberadamente mínima: solo trim y colapso de
 * espacios internos, que es lo que un `textarea` agrega sin que nadie lo
 * quiera. NO baja a minúsculas ni saca tildes — editar la acentuación o la
 * mayúscula **es** editar. "Sin editar" es una condición binaria, no un
 * parecido: normalizar de más convertiría "lo modificó un poco" en "eligió
 * una opción" y desactivaría la repregunta justo donde sí corresponde.
 */

function normalizar(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function esOpcionSinEditar(text: string, options: string[]): boolean {
  if (options.length === 0) return false;

  const candidato = normalizar(text);
  if (candidato === '') return false;

  return options.some((opcion) => normalizar(opcion) === candidato);
}
