import {
  ItemParaMejorar,
  DescarteVigente,
  armarLista,
  ordenar,
  deduplicar,
  estaDescartado,
  yaSeEntrevisto,
} from './improvements-list';

const OVERLAP = 0.5;

function tema(
  over: Partial<ItemParaMejorar> & { id: string; queryCount: number },
): ItemParaMejorar {
  return {
    source: 'CONSULTA_FALLIDA',
    title: `tema ${over.id}`,
    evidence: `${over.queryCount} consultas quedaron sin respuesta firme`,
    themeQueryEventIds: [`q-${over.id}`],
    queryDates: [new Date('2026-08-01')],
    canInterview: true,
    canDismiss: true,
    ...over,
    id: `tema:${over.id}`,
  };
}

function escalado(id: string): ItemParaMejorar {
  return {
    id: `esc:${id}`,
    source: 'ESCALADO',
    title: `caso ${id}`,
    evidence: 'un caso escalado que nunca se guardó como conocimiento',
    escalationId: id,
    canInterview: true,
    canDismiss: true,
  };
}

function docItem(
  id: string,
  severity: number,
  version = 1,
  esTransversal = false,
): ItemParaMejorar {
  return {
    id: `doc:${id}`,
    source: 'DOCUMENTO_INCONCLUSO',
    title: `documento ${id}`,
    evidence: 'el título promete algo que el cuerpo no cubre',
    document: { id, title: `documento ${id}`, version, esTransversal },
    unansweredQuestions: ['¿y si llega dañado?'],
    severity,
    canInterview: true,
    canDismiss: true,
  };
}

const VACIO = {
  descartes: [] as DescarteVigente[],
  marcasViejas: [],
  previas: [],
  overlapCut: OVERLAP,
  maxItems: 15,
};

describe('ordenar (FR-020/FR-021)', () => {
  it('pone las consultas fallidas primero y los documentos último', () => {
    const salida = ordenar([
      docItem('d', 90),
      escalado('e'),
      tema({ id: 't', queryCount: 2 }),
    ]);
    expect(salida.map((i) => i.source)).toEqual([
      'CONSULTA_FALLIDA',
      'ESCALADO',
      'DOCUMENTO_INCONCLUSO',
    ]);
  });

  // Que seis personas hayan preguntado algo pesa más que la opinión del modelo
  // sobre un documento que nadie consultó. Un tema de 2 consultas va ANTES que
  // un documento de severidad 95.
  it('un tema flojo gana igual a un documento de severidad altísima', () => {
    const salida = ordenar([
      docItem('d', 95),
      tema({ id: 't', queryCount: 2 }),
    ]);
    expect(salida[0].source).toBe('CONSULTA_FALLIDA');
  });

  it('dentro de las consultas fallidas, pesa más lo más preguntado', () => {
    const salida = ordenar([
      tema({ id: 'a', queryCount: 2 }),
      tema({ id: 'b', queryCount: 9 }),
    ]);
    expect(salida.map((i) => i.queryCount)).toEqual([9, 2]);
  });

  it('dentro de los documentos, pesa más la severidad', () => {
    const salida = ordenar([docItem('a', 82), docItem('b', 95)]);
    expect(salida.map((i) => i.severity)).toEqual([95, 82]);
  });
});

describe('deduplicar (FR-022)', () => {
  it('un documento señalado por dos fuentes aparece una sola vez, con la de más evidencia', () => {
    const porTema = tema({ id: 't', queryCount: 4 });
    porTema.document = {
      id: 'D1',
      title: 'Envíos',
      version: 1,
      esTransversal: false,
    };
    const salida = deduplicar(ordenar([docItem('D1', 90), porTema]));
    expect(salida).toHaveLength(1);
    expect(salida[0].source).toBe('CONSULTA_FALLIDA');
  });

  it('no confunde ítems sin documento entre sí', () => {
    expect(deduplicar([escalado('a'), escalado('b')])).toHaveLength(2);
  });
});

describe('el descarte (FR-025/FR-026/FR-026a)', () => {
  const descarteDoc = (
    documentId: string,
    documentVersion: number,
  ): DescarteVigente => ({
    source: 'DOCUMENTO_INCONCLUSO',
    themeQueryEventIds: [],
    escalationId: null,
    documentId,
    documentVersion,
    dismissedAt: new Date('2026-08-10'),
  });

  it('un descarte de documento con la MISMA versión filtra', () => {
    expect(
      estaDescartado(docItem('D1', 90, 3), [descarteDoc('D1', 3)], [], OVERLAP),
    ).toBe(true);
  });

  // Lo que se descartó fue el documento tal como estaba, no el documento para
  // siempre. Si se editó, vuelve a mirarse.
  it('un descarte de documento con OTRA versión no filtra', () => {
    expect(
      estaDescartado(docItem('D1', 90, 4), [descarteDoc('D1', 3)], [], OVERLAP),
    ).toBe(false);
  });

  it('un escalado descartado filtra por su id', () => {
    const d: DescarteVigente = {
      source: 'ESCALADO',
      themeQueryEventIds: [],
      escalationId: 'E1',
      documentId: null,
      documentVersion: null,
      dismissedAt: new Date('2026-08-10'),
    };
    expect(estaDescartado(escalado('E1'), [d], [], OVERLAP)).toBe(true);
    expect(estaDescartado(escalado('E2'), [d], [], OVERLAP)).toBe(false);
  });

  it('una marca vieja de CoverageThemeMark filtra su tema por solape, no por etiqueta', () => {
    const t = tema({ id: 'x', queryCount: 2 });
    t.themeQueryEventIds = ['q1', 'q2'];
    t.queryDates = [new Date('2026-08-01'), new Date('2026-08-02')];
    t.title = 'Demoras en la entrega'; // el LLM lo renombra en cada corrida
    const marca = {
      themeId: 'viejo',
      queryEventIds: ['q1', 'q2'],
      markedAt: new Date('2026-08-05'),
    };
    expect(estaDescartado(t, [], [marca], OVERLAP)).toBe(true);
  });

  // ⚠️ El caso que protege FR-026a. Un tema descartado VUELVE cuando llega
  // tráfico posterior al descarte: es lo que hace visible a un reincidente, y
  // leer la marca como booleano lo suprimiría para siempre EN SILENCIO.
  it('un tema descartado vuelve si hay una consulta posterior al descarte', () => {
    const t = tema({ id: 'x', queryCount: 3 });
    t.themeQueryEventIds = ['q1', 'q2'];
    t.queryDates = [new Date('2026-08-01'), new Date('2026-08-20')];
    const marca = {
      themeId: 'viejo',
      queryEventIds: ['q1', 'q2'],
      markedAt: new Date('2026-08-05'),
    };
    expect(estaDescartado(t, [], [marca], OVERLAP)).toBe(false);
  });

  it('sin tráfico posterior, el mismo tema sigue filtrado', () => {
    const t = tema({ id: 'x', queryCount: 3 });
    t.themeQueryEventIds = ['q1', 'q2'];
    t.queryDates = [new Date('2026-08-01'), new Date('2026-08-02')];
    const marca = {
      themeId: 'viejo',
      queryEventIds: ['q1', 'q2'],
      markedAt: new Date('2026-08-05'),
    };
    expect(estaDescartado(t, [], [marca], OVERLAP)).toBe(true);
  });
});

describe('yaSeEntrevisto (FR-023)', () => {
  it('un documento ya entrevistado en su versión actual no se vuelve a ofrecer', () => {
    const previas = [
      {
        themeQueryEventIds: [],
        escalationId: null,
        documentId: 'D1',
        documentVersion: 2,
      },
    ];
    expect(yaSeEntrevisto(docItem('D1', 90, 2), previas, OVERLAP)).toBe(true);
    expect(yaSeEntrevisto(docItem('D1', 90, 3), previas, OVERLAP)).toBe(false);
  });

  it('un tema ya preguntado se reconoce por solape aunque cambie la etiqueta', () => {
    const t = tema({ id: 'x', queryCount: 2 });
    t.themeQueryEventIds = ['q1', 'q2'];
    const previas = [
      {
        themeQueryEventIds: ['q1', 'q2'],
        escalationId: null,
        documentId: null,
        documentVersion: null,
      },
    ];
    expect(yaSeEntrevisto(t, previas, OVERLAP)).toBe(true);
  });
});

describe('armarLista — el invariante (SC-002 y FR-022)', () => {
  it('el corte va DESPUÉS de ordenar: no se pierde lo de más evidencia', () => {
    const crudos = [
      ...Array.from({ length: 20 }, (_, i) => docItem(`d${i}`, 85)),
      tema({ id: 'importante', queryCount: 9 }),
    ];
    const salida = armarLista(crudos, { ...VACIO, maxItems: 3 });
    expect(salida).toHaveLength(3);
    expect(salida[0].id).toBe('tema:importante');
  });

  // Test basado en propiedades: sobre entradas aleatorias de las tres fuentes,
  // la lista nunca supera el tope y nunca repite un documento. Es SC-002 y
  // FR-022 en un solo invariante — y no depende de que se me ocurra el caso.
  it('sobre 200 entradas aleatorias: nunca supera el tope ni repite documento', () => {
    for (let corrida = 0; corrida < 200; corrida++) {
      const n = Math.floor(Math.random() * 60);
      const maxItems = 1 + Math.floor(Math.random() * 20);
      const crudos: ItemParaMejorar[] = [];
      for (let i = 0; i < n; i++) {
        const dado = Math.random();
        // Pocos ids de documento a propósito: fuerza colisiones entre fuentes.
        const docId = `D${Math.floor(Math.random() * 5)}`;
        if (dado < 0.34) {
          const t = tema({
            id: `t${i}`,
            queryCount: Math.floor(Math.random() * 10),
          });
          if (Math.random() < 0.5) {
            t.document = {
              id: docId,
              title: docId,
              version: 1,
              esTransversal: false,
            };
          }
          crudos.push(t);
        } else if (dado < 0.67) {
          crudos.push(escalado(`e${i}`));
        } else {
          crudos.push(docItem(docId, Math.floor(Math.random() * 101)));
        }
      }

      const salida = armarLista(crudos, { ...VACIO, maxItems });

      expect(salida.length).toBeLessThanOrEqual(maxItems);
      const docIds = salida.map((i) => i.document?.id).filter(Boolean);
      expect(new Set(docIds).size).toBe(docIds.length);
    }
  });

  it('filtra descartados y ya entrevistados antes de cortar', () => {
    const crudos = [docItem('D1', 90), docItem('D2', 88), docItem('D3', 86)];
    const salida = armarLista(crudos, {
      ...VACIO,
      descartes: [
        {
          source: 'DOCUMENTO_INCONCLUSO',
          themeQueryEventIds: [],
          escalationId: null,
          documentId: 'D1',
          documentVersion: 1,
          dismissedAt: new Date(),
        },
      ],
      previas: [
        {
          themeQueryEventIds: [],
          escalationId: null,
          documentId: 'D2',
          documentVersion: 1,
        },
      ],
    });
    expect(salida.map((i) => i.document?.id)).toEqual(['D3']);
  });
});
