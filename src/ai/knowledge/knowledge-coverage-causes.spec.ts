import {
  classifyQuery,
  applyHygieneOverride,
  CoverageCuts,
  CoverageCandidate,
} from './knowledge-coverage-causes';

/**
 * Los cortes reales medidos en la Fase 0 de la spec 009 (research.md):
 * piso de ruido 54.3, umbral 65 (RAG_CONFIDENCE_THRESHOLD), margen "al
 * límite" 5 puntos (valores de partida de COVERAGE_MARGINAL_BAND).
 */
const CUTS: CoverageCuts = { noiseFloor: 54.3, threshold: 65, marginalBand: 5 };

function cand(documentId: string, score: number, rank = 0): CoverageCandidate {
  return { documentId, score, rank };
}

describe('classifyQuery — los 7 turnos reales de la base (Fase 0)', () => {
  it('«si por favor» (52.3, dentro del piso) → NO_ES_DEL_CORPUS, NO NO_HAY_NADA — es una respuesta al agente, no un hueco del corpus', () => {
    const r = classifyQuery(
      {
        candidates: [
          cand('doc-comprobantes', 52.3),
          cand('doc-promo', 52.1, 1),
        ],
        esPreguntaDeConocimiento: false, // sale del pase de LLM: no se sostiene sola
      },
      CUTS,
    );

    expect(r).not.toBeNull();
    expect(r!.cause).toBe('NO_ES_DEL_CORPUS');
    expect(r!.action).toBe('NINGUNA');
    expect(r!.documents).toEqual([]);
  });

  it('«qué sabes sobre la empresa?» (62.1, entre piso y umbral) → QUEDO_CORTO, con el documento nombrado', () => {
    const r = classifyQuery(
      {
        candidates: [
          cand('doc-sobre-nosotros', 62.1),
          cand('doc-promo', 61.3, 1),
        ],
        esPreguntaDeConocimiento: true,
      },
      CUTS,
    );

    expect(r!.cause).toBe('QUEDO_CORTO');
    expect(r!.action).toBe('CORREGIR_DOCUMENTO');
    expect(r!.documents).toEqual([cand('doc-sobre-nosotros', 62.1)]);
  });

  it('«que garantia tienen las heladeras?» (78.4, el mejor contestado de la base) → no forma parte del resumen (contestó holgado, fuera del margen "al límite")', () => {
    const r = classifyQuery(
      {
        candidates: [cand('doc-garantia', 78.4)],
        esPreguntaDeConocimiento: true,
      },
      CUTS,
    );
    expect(r).toBeNull();
  });

  it('un turno contestado JUSTO al límite (67, umbral 65 + margen 5) → band AL_LIMITE, sin causa (son ejes distintos)', () => {
    const r = classifyQuery(
      {
        candidates: [cand('doc-garantia', 67)],
        esPreguntaDeConocimiento: true,
      },
      CUTS,
    );
    expect(r!.band).toBe('AL_LIMITE');
    expect(r!.cause).toBeNull();
    expect(r!.action).toBe('NINGUNA');
    expect(r!.documents).toEqual([cand('doc-garantia', 67)]);
  });

  it('un turno contestado exactamente en el umbral (65.0) entra en AL_LIMITE, no queda afuera por el borde', () => {
    const r = classifyQuery(
      { candidates: [cand('doc-x', 65)], esPreguntaDeConocimiento: true },
      CUTS,
    );
    expect(r!.band).toBe('AL_LIMITE');
  });
});

describe('classifyQuery — invariante SC-001: CARGAR nunca convive con documentos', () => {
  it('sin candidatos y pregunta de conocimiento real → NO_HAY_NADA, CARGAR, documents: []', () => {
    const r = classifyQuery(
      { candidates: [], esPreguntaDeConocimiento: true },
      CUTS,
    );
    expect(r!.cause).toBe('NO_HAY_NADA');
    expect(r!.action).toBe('CARGAR');
    expect(r!.documents).toEqual([]);
  });

  it('propiedad: para cualquier score bajo el piso y esPreguntaDeConocimiento aleatorio, action === CARGAR ⟹ documents.length === 0', () => {
    for (let i = 0; i < 200; i++) {
      const score = Math.random() * CUTS.noiseFloor; // siempre bajo el piso
      const nCandidatos = Math.floor(Math.random() * 4);
      const candidates = Array.from({ length: nCandidatos }, (_, j) =>
        cand(`doc-${j}`, score - j, j),
      );
      const esPregunta = Math.random() > 0.5;

      const r = classifyQuery(
        { candidates, esPreguntaDeConocimiento: esPregunta },
        CUTS,
      );
      if (r?.action === 'CARGAR') {
        expect(r.documents).toEqual([]);
      }
    }
  });

  it('propiedad: action === CARGAR ⟹ cause === NO_HAY_NADA (nunca sale de otra causa)', () => {
    for (const esPregunta of [true, false]) {
      const r = classifyQuery(
        { candidates: [], esPreguntaDeConocimiento: esPregunta },
        CUTS,
      );
      if (r?.action === 'CARGAR') {
        expect(r.cause).toBe('NO_HAY_NADA');
      }
    }
  });
});

describe('classifyQuery — desempate FR-004 y turnos históricos (FR-021)', () => {
  it('ante la duda (sin candidatos), gana NO_ES_DEL_CORPUS cuando esPreguntaDeConocimiento es false', () => {
    const r = classifyQuery(
      { candidates: [], esPreguntaDeConocimiento: false },
      CUTS,
    );
    expect(r!.cause).toBe('NO_ES_DEL_CORPUS');
  });

  it('un turno sin `candidates` (histórico, FR-021) sale INDETERMINADA, sin importar esPreguntaDeConocimiento', () => {
    const r1 = classifyQuery(
      { candidates: null, esPreguntaDeConocimiento: true },
      CUTS,
    );
    const r2 = classifyQuery(
      { candidates: null, esPreguntaDeConocimiento: false },
      CUTS,
    );
    expect(r1!.cause).toBe('INDETERMINADA');
    expect(r2!.cause).toBe('INDETERMINADA');
    expect(r1!.documents).toEqual([]);
  });
});

describe('applyHygieneOverride — el cruce con HygienePair (spec 008)', () => {
  it('QUEDO_CORTO cuyo documento integra una pareja abierta → SE_COMPITEN, REVISAR_HIGIENE, con hygienePairId', () => {
    const base = classifyQuery(
      { candidates: [cand('doc-a', 62)], esPreguntaDeConocimiento: true },
      CUTS,
    );
    expect(base!.cause).toBe('QUEDO_CORTO'); // precondición del test

    const pares = new Map([
      ['doc-a', { pairId: 'pair-1', otherDocumentId: 'doc-b' }],
    ]);
    const r = applyHygieneOverride(base, [cand('doc-a', 62)], pares);

    expect(r!.cause).toBe('SE_COMPITEN');
    expect(r!.action).toBe('REVISAR_HIGIENE');
    expect(r!.hygienePairId).toBe('pair-1');
    expect(r!.documents).toEqual([cand('doc-a', 62)]);
  });

  it('NO se aplica sobre NO_HAY_NADA: un documento de ruido en una pareja no se convierte en señal', () => {
    const base = classifyQuery(
      { candidates: [], esPreguntaDeConocimiento: true },
      CUTS,
    );
    expect(base!.cause).toBe('NO_HAY_NADA');

    const pares = new Map([
      ['doc-a', { pairId: 'pair-1', otherDocumentId: 'doc-b' }],
    ]);
    const r = applyHygieneOverride(base, [], pares);

    expect(r!.cause).toBe('NO_HAY_NADA'); // sin cambios
    expect(r!.hygienePairId).toBeNull();
  });

  it('NO se aplica sobre AL_LIMITE (cause null): no reintroduce una causa donde no hay', () => {
    const base = classifyQuery(
      { candidates: [cand('doc-a', 67)], esPreguntaDeConocimiento: true },
      CUTS,
    );
    expect(base!.band).toBe('AL_LIMITE');

    const pares = new Map([
      ['doc-a', { pairId: 'pair-1', otherDocumentId: 'doc-b' }],
    ]);
    const r = applyHygieneOverride(base, [cand('doc-a', 67)], pares);

    expect(r!.cause).toBeNull();
    expect(r!.hygienePairId).toBeNull();
  });

  it('QUEDO_CORTO sin ninguna pareja abierta → sin cambios, hygienePairId null', () => {
    const base = classifyQuery(
      { candidates: [cand('doc-a', 62)], esPreguntaDeConocimiento: true },
      CUTS,
    );
    const r = applyHygieneOverride(base, [cand('doc-a', 62)], new Map());

    expect(r!.cause).toBe('QUEDO_CORTO');
    expect(r!.hygienePairId).toBeNull();
  });

  it('propaga `null` cuando classifyQuery ya descartó el turno (contestó holgado)', () => {
    const base = classifyQuery(
      { candidates: [cand('doc-a', 95)], esPreguntaDeConocimiento: true },
      CUTS,
    );
    expect(base).toBeNull();

    const r = applyHygieneOverride(base, [cand('doc-a', 95)], new Map());
    expect(r).toBeNull();
  });

  it('documenta la expectativa medida (research.md D3): sobre las 24 parejas reales, ningún documento candidato de un turno real cae en el mapa de parejas abiertas — el cruce no dispara sin que nadie lo haya puesto ahí', () => {
    // "me interesan healderas, venden?" (65.6 → QUEDO_CORTO con el umbral de
    // 65.8, así que se usa un score real de la misma banda: 62.1) con el
    // documento que de verdad la contestó, y un mapa vacío porque hoy
    // ninguna de las 24 parejas de higiene tiene a ese documento como parte.
    const base = classifyQuery(
      {
        candidates: [cand('doc-financiacion-heladeras', 62.1)],
        esPreguntaDeConocimiento: true,
      },
      CUTS,
    );
    expect(base!.cause).toBe('QUEDO_CORTO'); // precondición: en la banda que SÍ cruza contra higiene
    const r = applyHygieneOverride(
      base,
      [cand('doc-financiacion-heladeras', 62.1)],
      new Map(),
    );
    expect(r!.cause).toBe('QUEDO_CORTO'); // sin cambios: no había pareja que cruzar
    expect(r!.hygienePairId).toBeNull();
  });
});

describe('classifyQuery — banda AL_LIMITE, conteos separados (US3, FR-022/FR-023)', () => {
  it('un turno SIN_RESPUESTA y otro AL_LIMITE del mismo tema clasifican distinto — no comparten banda ni causa', () => {
    const sinRespuesta = classifyQuery(
      { candidates: [cand('doc-a', 60)], esPreguntaDeConocimiento: true },
      CUTS,
    );
    const alLimite = classifyQuery(
      { candidates: [cand('doc-a', 68)], esPreguntaDeConocimiento: true },
      CUTS,
    );

    expect(sinRespuesta!.band).toBe('SIN_RESPUESTA');
    expect(sinRespuesta!.cause).toBe('QUEDO_CORTO');
    expect(alLimite!.band).toBe('AL_LIMITE');
    expect(alLimite!.cause).toBeNull();
  });

  it('el límite superior (umbral + margen) NO entra en AL_LIMITE: contestó holgado, se descarta', () => {
    const r = classifyQuery(
      {
        candidates: [cand('doc-a', CUTS.threshold + CUTS.marginalBand)],
        esPreguntaDeConocimiento: true,
      },
      CUTS,
    );
    expect(r).toBeNull(); // 70 exacto no es < 70
  });

  it('un punto adentro del margen (69.9) sí entra en AL_LIMITE', () => {
    const r = classifyQuery(
      {
        candidates: [cand('doc-a', CUTS.threshold + CUTS.marginalBand - 0.1)],
        esPreguntaDeConocimiento: true,
      },
      CUTS,
    );
    expect(r!.band).toBe('AL_LIMITE');
  });
});
