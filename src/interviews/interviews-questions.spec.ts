import {
  elegirForma,
  excluirPorCausa,
  yaPreguntado,
  MaterialDePregunta,
  MaterialDocumento,
  PreguntaPrevia,
} from './interviews-questions';

function doc(
  id: string,
  overrides: Partial<MaterialDocumento> = {},
): MaterialDocumento {
  return { id, title: `Doc ${id}`, version: 1, isActive: true, ...overrides };
}

function temaMaterial(
  overrides: Partial<
    Extract<MaterialDePregunta, { origin: 'TEMA_COBERTURA' }>
  > = {},
): Extract<MaterialDePregunta, { origin: 'TEMA_COBERTURA' }> {
  return {
    origin: 'TEMA_COBERTURA',
    themeId: 'tema-1',
    label: 'Plazos de entrega',
    agentType: 'SALES',
    band: 'SIN_RESPUESTA',
    cause: 'NO_HAY_NADA',
    queryEventIds: ['ev-1', 'ev-2'],
    quotes: ['cuanto tarda en llegar?'],
    queryCount: 2,
    documents: [],
    ...overrides,
  };
}

describe('elegirForma — invariante SC-001', () => {
  it('sin documentos → PEDIR_NUEVO', () => {
    expect(elegirForma(temaMaterial({ documents: [] }))).toBe('PEDIR_NUEVO');
  });

  it('con documento → CORREGIR', () => {
    expect(elegirForma(temaMaterial({ documents: [doc('d1')] }))).toBe(
      'CORREGIR',
    );
  });

  it('D1: banda AL_LIMITE sin causa, pero con documento → CORREGIR, no PEDIR_NUEVO', () => {
    const material = temaMaterial({
      band: 'AL_LIMITE',
      cause: null,
      documents: [doc('d1')],
    });
    expect(elegirForma(material)).toBe('CORREGIR');
  });

  it('escalado sin capitalizar → GENERALIZAR', () => {
    expect(
      elegirForma({
        origin: 'ESCALADO_SIN_CAPITALIZAR',
        escalationId: 'esc-1',
        resolutionText: 'Hola Juan, tu pedido sale el martes.',
      }),
    ).toBe('GENERALIZAR');
  });

  it('escalado pendiente → ABIERTA', () => {
    expect(
      elegirForma({
        origin: 'ESCALADO_PENDIENTE',
        escalationId: 'esc-2',
        quotes: ['a que hora abren?'],
      }),
    ).toBe('ABIERTA');
  });

  it('propiedad: sobre entradas aleatorias, PEDIR_NUEVO implica cero documentos — sin excepciones, incluida la banda AL_LIMITE y los temas sin causa', () => {
    const bandas: Array<'SIN_RESPUESTA' | 'AL_LIMITE'> = [
      'SIN_RESPUESTA',
      'AL_LIMITE',
    ];
    const causas: Array<'NO_HAY_NADA' | 'QUEDO_CORTO' | null> = [
      'NO_HAY_NADA',
      'QUEDO_CORTO',
      null,
    ];
    for (let i = 0; i < 200; i++) {
      const nDocs = Math.floor(Math.random() * 3);
      const material = temaMaterial({
        band: bandas[Math.floor(Math.random() * bandas.length)],
        cause: causas[Math.floor(Math.random() * causas.length)],
        documents: Array.from({ length: nDocs }, (_, j) => doc(`d${j}`)),
      });
      const kind = elegirForma(material);
      if (kind === 'PEDIR_NUEVO') {
        expect(material.documents.length).toBe(0);
      }
    }
  });

  // Spec 011: el mismo invariante, ahora con los CUATRO orígenes. Que un
  // origen nuevo lo rompa sin que nadie lo note es el riesgo que este test
  // existe para atajar — un `PEDIR_NUEVO` con documento al lado convierte la
  // entrevista en la máquina de duplicados más eficiente del sistema.
  it('propiedad (spec 011): PEDIR_NUEVO implica cero documentos, sobre los cuatro orígenes', () => {
    const documentosDe = (m: MaterialDePregunta) => {
      if (m.origin === 'TEMA_COBERTURA') return m.documents;
      if (m.origin === 'DOCUMENTO_INCONCLUSO') return [m.document];
      return [];
    };

    for (let i = 0; i < 200; i++) {
      const dado = Math.random();
      let material: MaterialDePregunta;
      if (dado < 0.25) {
        material = temaMaterial({
          documents: Array.from(
            { length: Math.floor(Math.random() * 3) },
            (_, j) => doc(`d${j}`),
          ),
        });
      } else if (dado < 0.5) {
        material = {
          origin: 'ESCALADO_SIN_CAPITALIZAR',
          escalationId: `e${i}`,
          resolutionText: 'se le repuso el producto',
        };
      } else if (dado < 0.75) {
        material = {
          origin: 'ESCALADO_PENDIENTE',
          escalationId: `e${i}`,
          quotes: ['¿y si llega dañado?'],
        };
      } else {
        material = {
          origin: 'DOCUMENTO_INCONCLUSO',
          document: doc(`d${i}`),
          unansweredQuestions: ['¿quién absorbe el costo del nuevo envío?'],
          reason: 'el título habla de daños y el cuerpo solo cubre retrasos',
          severity: Math.floor(Math.random() * 101),
        };
      }

      if (elegirForma(material) === 'PEDIR_NUEVO') {
        expect(documentosDe(material).length).toBe(0);
      }
    }
  });

  // Un documento inconcluso SIEMPRE trae documento, así que la forma es
  // corregir ese documento — nunca escribir uno nuevo al lado.
  it('spec 011: DOCUMENTO_INCONCLUSO → CORREGIR', () => {
    expect(
      elegirForma({
        origin: 'DOCUMENTO_INCONCLUSO',
        document: doc('d1'),
        unansweredQuestions: ['¿y si llega dañado?'],
        reason: 'el título promete algo que el cuerpo no cubre',
        severity: 85,
      }),
    ).toBe('CORREGIR');
  });
});

describe('excluirPorCausa — FR-008', () => {
  it('SE_COMPITEN se excluye', () => {
    expect(excluirPorCausa(temaMaterial({ cause: 'SE_COMPITEN' }))).toBe(true);
  });

  it('NO_ES_DEL_CORPUS se excluye', () => {
    expect(excluirPorCausa(temaMaterial({ cause: 'NO_ES_DEL_CORPUS' }))).toBe(
      true,
    );
  });

  it('QUEDO_CORTO no se excluye', () => {
    expect(excluirPorCausa(temaMaterial({ cause: 'QUEDO_CORTO' }))).toBe(false);
  });

  it('un escalado nunca se excluye por esta regla', () => {
    expect(
      excluirPorCausa({
        origin: 'ESCALADO_PENDIENTE',
        escalationId: 'esc-1',
        quotes: [],
      }),
    ).toBe(false);
  });
});

describe('yaPreguntado — FR-006b/c (C1, /speckit-analyze)', () => {
  const overlapCut = 0.5;

  it('un tema con las mismas consultas que uno de una sesión previa se excluye, aunque su etiqueta sea otra', () => {
    const material = temaMaterial({
      label: 'Demoras en la entrega', // etiqueta DISTINTA a propósito
      queryEventIds: ['ev-1', 'ev-2'],
    });
    const previos: PreguntaPrevia[] = [
      { themeQueryEventIds: ['ev-1', 'ev-2', 'ev-3'], escalationId: null },
    ];
    expect(yaPreguntado(material, previos, overlapCut)).toBe(true);
  });

  it('un tema con consultas distintas no se excluye', () => {
    const material = temaMaterial({ queryEventIds: ['ev-9', 'ev-10'] });
    const previos: PreguntaPrevia[] = [
      { themeQueryEventIds: ['ev-1', 'ev-2'], escalationId: null },
    ];
    expect(yaPreguntado(material, previos, overlapCut)).toBe(false);
  });

  it('un escalado ya usado se excluye por id', () => {
    const material: MaterialDePregunta = {
      origin: 'ESCALADO_PENDIENTE',
      escalationId: 'esc-1',
      quotes: [],
    };
    const previos: PreguntaPrevia[] = [
      { themeQueryEventIds: [], escalationId: 'esc-1' },
    ];
    expect(yaPreguntado(material, previos, overlapCut)).toBe(true);
  });

  it('un escalado con id distinto no se excluye', () => {
    const material: MaterialDePregunta = {
      origin: 'ESCALADO_SIN_CAPITALIZAR',
      escalationId: 'esc-2',
      resolutionText: '…',
    };
    const previos: PreguntaPrevia[] = [
      { themeQueryEventIds: [], escalationId: 'esc-1' },
    ];
    expect(yaPreguntado(material, previos, overlapCut)).toBe(false);
  });

  it('spec 011: un documento ya entrevistado en su versión actual se excluye', () => {
    const material: MaterialDePregunta = {
      origin: 'DOCUMENTO_INCONCLUSO',
      document: { id: 'D1', title: 'Envíos', version: 2, isActive: true },
      unansweredQuestions: ['¿y si llega dañado?'],
      reason: 'quedó corto',
      severity: 85,
    };
    const previos = [
      {
        themeQueryEventIds: [],
        escalationId: null,
        documentId: 'D1',
        documentVersion: 2,
      },
    ];
    expect(yaPreguntado(material, previos, 0.5)).toBe(true);
  });

  // FR-026: lo que se entrevistó fue el documento tal como estaba. Si se
  // editó después, vuelve a preguntarse.
  it('spec 011: el mismo documento en OTRA versión no se excluye', () => {
    const material: MaterialDePregunta = {
      origin: 'DOCUMENTO_INCONCLUSO',
      document: { id: 'D1', title: 'Envíos', version: 3, isActive: true },
      unansweredQuestions: ['¿y si llega dañado?'],
      reason: 'quedó corto',
      severity: 85,
    };
    const previos = [
      {
        themeQueryEventIds: [],
        escalationId: null,
        documentId: 'D1',
        documentVersion: 2,
      },
    ];
    expect(yaPreguntado(material, previos, 0.5)).toBe(false);
  });

  it('sin previos, nada se excluye', () => {
    expect(yaPreguntado(temaMaterial(), [], overlapCut)).toBe(false);
  });
});
