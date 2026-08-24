/**
 * Clasificación de causa de un turno de consulta (spec 009, US1).
 *
 * Función PURA a propósito: sin acceso a base ni a red, para que las cuatro
 * causas (y el desempate entre ellas) sean el código más fácil de verificar
 * de toda la spec — es donde vive SC-001 (ningún tema propone "cargar" si
 * hay un documento cerca).
 *
 * La Fase 0 (research.md) corrigió dos supuestos de la pre-spec, y este
 * archivo implementa las versiones corregidas, no las originales:
 *
 *   - "Se compiten" NO se detecta por la brecha entre el mejor y el segundo
 *     candidato del top-k: medido sobre los 7 turnos reales, esa brecha va
 *     de 0.2 a 4.6 puntos y es MÁS CHICA en el turno mejor contestado. Se
 *     resuelve por cruce con `HygienePair` (spec 008) — `applyHygieneOverride`.
 *   - Estar bajo el piso de ruido NO significa "falta cargar": el único turno
 *     real que cae ahí («si por favor») es una respuesta al agente, no un
 *     hueco del corpus. El discriminador es si la consulta se sostiene sola
 *     como pregunta de conocimiento (`esPreguntaDeConocimiento`, que sale del
 *     mismo pase de LLM que agrupa los temas — D5).
 */

export type CoverageBand = 'SIN_RESPUESTA' | 'AL_LIMITE';

export type CoverageCause =
  | 'NO_HAY_NADA'
  | 'QUEDO_CORTO'
  | 'SE_COMPITEN'
  | 'NO_ES_DEL_CORPUS'
  | 'INDETERMINADA';

export type CoverageAction =
  | 'CARGAR'
  | 'CORREGIR_DOCUMENTO'
  | 'REVISAR_HIGIENE'
  | 'NINGUNA'
  | 'DERIVAR';

/** Candidato del turno, en la escala 0-100 (igual que `KnowledgeRetrieval.score`). */
export interface CoverageCandidate {
  documentId: string;
  score: number;
  rank: number;
}

export interface CoverageQueryInput {
  /**
   * Candidatos del turno. `null` = sin telemetría (turno histórico sin
   * `candidates` en el payload, FR-021) → INDETERMINADA sin más análisis.
   * `[]` = se buscó y no vino nada (no ocurre hoy, medido en research.md D1,
   * pero el formato lo cubre).
   */
  candidates: CoverageCandidate[] | null;
  /**
   * ¿La consulta se sostiene sola como pregunta de conocimiento? Sale del
   * mismo pase de LLM que agrupa los temas (D5) — NO se deriva del score.
   * Irrelevante si `candidates` alcanza el umbral (no hace falta para band
   * AL_LIMITE ni para causas por encima del piso).
   */
  esPreguntaDeConocimiento: boolean;
}

export interface CoverageCuts {
  /** Piso de ruido medido en la spec 006 (`COVERAGE_NOISE_FLOOR`), 0-100. */
  noiseFloor: number;
  /** `RAG_CONFIDENCE_THRESHOLD * 100`, 0-100. */
  threshold: number;
  /** Puntos sobre el umbral que son "al límite" (`COVERAGE_MARGINAL_BAND`). */
  marginalBand: number;
}

export interface CoverageClassification {
  band: CoverageBand;
  /**
   * `null` cuando `band === 'AL_LIMITE'`: la consulta SÍ se contestó por
   * encima del umbral, así que ninguna de las cuatro causas de "sin
   * respuesta" aplica (research.md, I3) — banda y causa son ejes distintos.
   */
  cause: CoverageCause | null;
  action: CoverageAction;
  /** El mejor score del turno, 0-100. `null` si no hubo candidatos. */
  bestScore: number | null;
  /** Documentos que sustentan la causa. SIEMPRE `[]` cuando `action === 'CARGAR'` — es SC-001. */
  documents: CoverageCandidate[];
}

/**
 * Clasifica UN turno (T010). No conoce higiene del corpus todavía —
 * `applyHygieneOverride` es el paso siguiente (T011), separado a propósito:
 * esta función es la lógica de las cuatro bandas de la tabla de research.md
 * D4, sin mezclarla con el cruce contra `HygienePair`.
 *
 * Devuelve `null` cuando el turno contestó **holgado** —por encima del
 * margen "al límite"—: no es un turno de interés para este resumen. FR-022
 * solo pide identificar lo que quedó sin respuesta y lo que contestó al
 * límite, no todo lo que contestó bien; incluirlo acá inflaría los temas con
 * ruido que nadie necesita revisar.
 */
export function classifyQuery(
  input: CoverageQueryInput,
  cuts: CoverageCuts,
): CoverageClassification | null {
  const { candidates, esPreguntaDeConocimiento } = input;
  const { noiseFloor, threshold, marginalBand } = cuts;

  // Sin telemetría (turno histórico sin `candidates`): no se adivina.
  if (candidates === null) {
    return {
      band: 'SIN_RESPUESTA',
      cause: 'INDETERMINADA',
      action: 'NINGUNA',
      bestScore: null,
      documents: [],
    };
  }

  const mejor = candidates.length > 0 ? candidates[0] : null;
  const bestScore = mejor?.score ?? null;

  // ≥ umbral: contestada. Solo interesa si cae dentro del margen "al límite"
  // configurado — por encima de eso, contestó holgado y no es un turno de
  // interés para este resumen (se descarta, `null`).
  if (bestScore !== null && bestScore >= threshold) {
    const enMargen = bestScore < threshold + marginalBand;
    if (!enMargen) return null;
    return {
      band: 'AL_LIMITE',
      cause: null,
      action: 'NINGUNA',
      bestScore,
      documents: mejor ? [mejor] : [],
    };
  }

  // Entre el piso de ruido y el umbral: hay algo, quedó corto.
  if (bestScore !== null && bestScore >= noiseFloor) {
    return {
      band: 'SIN_RESPUESTA',
      cause: 'QUEDO_CORTO',
      action: 'CORREGIR_DOCUMENTO',
      bestScore,
      documents: mejor ? [mejor] : [],
    };
  }

  // Por debajo del piso (o sin candidatos): el discriminador es si la
  // consulta se sostiene sola. Ante la duda, "no es del corpus" — FR-004:
  // no listar un tema cuesta un tema; proponer cargar de más cuesta un
  // documento duplicado.
  if (esPreguntaDeConocimiento) {
    return {
      band: 'SIN_RESPUESTA',
      cause: 'NO_HAY_NADA',
      action: 'CARGAR',
      bestScore,
      documents: [],
    };
  }

  return {
    band: 'SIN_RESPUESTA',
    cause: 'NO_ES_DEL_CORPUS',
    action: 'NINGUNA',
    bestScore,
    documents: [],
  };
}

/**
 * T011 — el cruce con higiene del corpus (spec 008). Si algún documento del
 * turno integra una pareja de higiene ABIERTA (de la última corrida `READY`
 * de `HygieneScan`), la causa pasa a "se compiten" y la acción a revisar la
 * higiene — reemplaza lo que `classifyQuery` haya decidido, incluida
 * QUEDO_CORTO: si el documento que "quedó corto" es en realidad la mitad de
 * una pareja que se pisa, corregirlo a ciegas sería tratar el síntoma en vez
 * de la causa (research.md D3).
 *
 * Solo se aplica sobre `QUEDO_CORTO`: es la única causa donde "el documento
 * es real pero insuficiente" es ambiguo entre "corregirlo" y "está compitiendo
 * con otro". NO_HAY_NADA y NO_ES_DEL_CORPUS ya decidieron que el mejor
 * candidato es ruido (por debajo del piso) — cruzarlo contra higiene ahí
 * convertiría una coincidencia de ruido en una señal que no es.
 *
 * @param hygienePairPorDocumento documentId → { pairId, otherDocumentId },
 *   ya resuelto por el llamador contra la última corrida de higiene READY.
 */
export function applyHygieneOverride(
  classification: CoverageClassification | null,
  candidates: CoverageCandidate[] | null,
  hygienePairPorDocumento: ReadonlyMap<
    string,
    { pairId: string; otherDocumentId: string }
  >,
): (CoverageClassification & { hygienePairId: string | null }) | null {
  if (!classification || classification.cause !== 'QUEDO_CORTO') {
    return classification ? { ...classification, hygienePairId: null } : null;
  }
  if (
    !candidates ||
    candidates.length === 0 ||
    hygienePairPorDocumento.size === 0
  ) {
    return { ...classification, hygienePairId: null };
  }

  const enPareja = candidates.filter((c) =>
    hygienePairPorDocumento.has(c.documentId),
  );
  if (enPareja.length === 0) {
    return { ...classification, hygienePairId: null };
  }

  const pairId = hygienePairPorDocumento.get(enPareja[0].documentId)!.pairId;
  return {
    ...classification,
    cause: 'SE_COMPITEN',
    action: 'REVISAR_HIGIENE',
    documents: enPareja,
    hygienePairId: pairId,
  };
}
