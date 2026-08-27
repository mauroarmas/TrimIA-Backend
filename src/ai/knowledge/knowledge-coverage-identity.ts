/**
 * Identidad de un tema entre corridas (spec 009, FR-028, D6).
 *
 * El nombre NO sirve como identidad: el LLM dice "Plazos de entrega" en una
 * corrida y "Demoras en la entrega" en la siguiente para el mismo grupo de
 * consultas. Lo estable es el CONJUNTO de consultas (`OrchestrationEvent.id`)
 * que lo forman — determinista, sin llamadas, y es lo que permite resolver
 * "atendido" (FR-026/FR-027) sin depender de que el modelo repita un texto.
 *
 * Función pura: sin acceso a base ni a red, misma razón que
 * `knowledge-coverage-causes.ts`.
 */

/**
 * Solape de Jaccard-asimétrico: sobre el tema NUEVO. `overlap(a, b)` mide
 * cuánto de `nuevo` está cubierto por `viejo` — no al revés. Un tema nuevo
 * que agregó consultas de otro tema no debería dejar de reconocerse solo
 * porque `viejo` es ahora una fracción más chica de la unión.
 */
export function overlap(
  nuevo: readonly string[],
  viejo: readonly string[],
): number {
  if (nuevo.length === 0) return 0;
  const viejoSet = new Set(viejo);
  const enComun = nuevo.filter((id) => viejoSet.has(id)).length;
  return enComun / nuevo.length;
}

export interface MarkedTheme {
  themeId: string;
  queryEventIds: string[];
  markedAt: Date;
}

export interface OverlapMatch {
  themeId: string;
  markedAt: Date;
}

/**
 * Resuelve con qué tema marcado (si alguno) se corresponde un tema nuevo.
 *
 * Puede haber más de una marca compatible cuando un tema reaparece, se
 * vuelve a marcar, y el corte de solape lo sigue asociando también con la
 * marca original. Gana la más reciente (`markedAt`): es la que refleja la
 * última vez que alguien dijo "ya me ocupé", y la que decide qué cuenta como
 * tráfico "nuevo" (FR-027).
 *
 * Sin solape suficiente → `null` (fallback de FR-028: ante duda, el tema es
 * nuevo y se muestra — mostrar de más molesta, ocultar de más esconde trabajo).
 */
export function resolveMark(
  nuevoQueryEventIds: readonly string[],
  marcados: readonly MarkedTheme[],
  overlapCut: number,
): OverlapMatch | null {
  const candidatas = marcados.filter(
    (m) => overlap(nuevoQueryEventIds, m.queryEventIds) >= overlapCut,
  );
  if (candidatas.length === 0) return null;

  const masReciente = candidatas.reduce((mejor, actual) =>
    actual.markedAt > mejor.markedAt ? actual : mejor,
  );
  return { themeId: masReciente.themeId, markedAt: masReciente.markedAt };
}
