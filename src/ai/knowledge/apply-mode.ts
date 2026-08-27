import { CandidateApplyMode } from '@prisma/client';

/**
 * Cómo se combina un texto nuevo con lo que un documento ya dice.
 *
 * Vive acá, como función pura y en su propio archivo, porque son **dos** los
 * lugares que corrigen un documento con texto aprobado por una persona —las
 * fichas de entrevista (spec 010) y la resolución de un caso escalado (spec
 * 007)— y la regla tiene que ser la misma en los dos. Antes existía una sola
 * vez, escrita en línea dentro de `aprobarCorreccion`; cuando el segundo lugar
 * la necesitó, copiarla habría dejado dos versiones de "qué significa agregar"
 * que pueden divergir sin que nada lo note.
 *
 * Los `trim` no son cosmética. `trimEnd` sobre lo actual y `trimStart` sobre lo
 * nuevo garantizan **exactamente** un renglón en blanco entre los dos bloques,
 * venga como venga cada uno: sin ellos, un documento que ya terminaba en salto
 * de línea y un texto que empieza con otro producen tres o cuatro, y el chunker
 * los lee como una separación de secciones que nadie quiso poner.
 */
export function componerContenido(
  modo: CandidateApplyMode,
  contenidoActual: string,
  contenidoNuevo: string,
): string {
  return modo === CandidateApplyMode.AGREGAR
    ? `${contenidoActual.trimEnd()}\n\n${contenidoNuevo.trimStart()}`
    : contenidoNuevo;
}
