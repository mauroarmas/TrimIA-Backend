import { DocumentReviewService } from './document-review.service';

/**
 * El detector, con el modelo mockeado. Lo que se prueba es lo determinista: el
 * corte, el incremental y que un fallo no deje señalamientos sueltos.
 *
 * Que el modelo *acierte* no se prueba acá y no se puede: "¿este documento
 * está realmente incompleto?" no tiene verdad objetiva contra la cual medir.
 * Lo que sí se midió en la Fase 0 es que discrimina.
 */

function buildConfig(over: Record<string, number> = {}) {
  const values: Record<string, number> = {
    DOC_REVIEW_SEVERITY_CUT: 80,
    DOC_REVIEW_MAX_FINDINGS: 10,
    DOC_REVIEW_STALE_MINUTES: 30,
    ...over,
  };
  return { get: jest.fn((k: string) => values[k]) };
}

function doc(id: string, version = 1, agentType: string | null = 'SALES') {
  return {
    id,
    title: `Documento ${id}`,
    content: 'contenido',
    category: null,
    version,
    agentType,
  };
}

function buildFakePrisma(documentos: any[], findingsPrevios: any[] = []) {
  const findings: any[] = [];
  const reviews: any[] = [
    {
      id: 'rev-1',
      sectorId: 'sector-ventas',
      agentType: 'SALES',
      status: 'RUNNING',
      severityCut: 80,
    },
  ];
  return {
    findings,
    reviews,
    prisma: {
      documentReview: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(reviews.find((r) => r.id === where.id) ?? null),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: any) => {
          const r = {
            id: `rev-${reviews.length + 1}`,
            status: 'RUNNING',
            ...data,
          };
          reviews.push(r);
          return Promise.resolve(r);
        }),
        update: jest.fn(({ where, data }: any) => {
          const r = reviews.find((x) => x.id === where.id) ?? { id: where.id };
          Object.assign(r, data);
          return Promise.resolve(r);
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      documentFinding: {
        findMany: jest.fn().mockResolvedValue(findingsPrevios),
        create: jest.fn(({ data }: any) => {
          findings.push(data);
          return Promise.resolve(data);
        }),
      },
      knowledgeDocument: {
        findMany: jest.fn().mockResolvedValue(documentos),
      },
    },
  };
}

function llmStub(respuestas: any[] | Error) {
  let i = 0;
  const invoke = jest.fn(() => {
    if (respuestas instanceof Error) return Promise.reject(respuestas);
    return Promise.resolve(respuestas[i++ % respuestas.length]);
  });
  return {
    classifierChat: { withStructuredOutput: jest.fn(() => ({ invoke })) },
    _invoke: invoke,
  };
}

const senala = (severity: number) => ({
  severity,
  reason: 'el título promete algo que el cuerpo no cubre',
  unansweredQuestions: ['¿y si llega dañado?'],
});

function build(
  documentos: any[],
  respuestas: any,
  findingsPrevios: any[] = [],
) {
  const { prisma, findings, reviews } = buildFakePrisma(
    documentos,
    findingsPrevios,
  );
  const llm = llmStub(respuestas);
  const service = new DocumentReviewService(
    prisma as any,
    buildConfig() as any,
    llm as any,
    { add: jest.fn() } as any,
  );
  return { service, prisma, findings, reviews, llm };
}

describe('DocumentReviewService — startReview (FR-018)', () => {
  it('encola y devuelve sin esperar', async () => {
    const { prisma } = buildFakePrisma([]);
    const queue = { add: jest.fn() };
    const service = new DocumentReviewService(
      prisma as any,
      buildConfig() as any,
      {} as any,
      queue as any,
    );

    const res = await service.startReview(
      'sector-ventas',
      'SALES' as any,
      'emp-1',
    );
    expect(res.reused).toBe(false);
    expect(queue.add).toHaveBeenCalled();
  });

  // Se engancha, NO rechaza: un 409 acá cancelaría también el barrido de
  // cobertura que `refresh` dispara junto con esto.
  it('se engancha a la revisión en curso de la misma área', async () => {
    const { prisma } = buildFakePrisma([]);
    prisma.documentReview.findFirst = jest.fn().mockResolvedValue({
      id: 'rev-en-curso',
      status: 'RUNNING',
      createdAt: new Date(), // recién arrancada: no está colgada
    });
    const queue = { add: jest.fn() };
    const service = new DocumentReviewService(
      prisma as any,
      buildConfig() as any,
      {} as any,
      queue as any,
    );

    const res = await service.startReview(
      'sector-ventas',
      'SALES' as any,
      'emp-1',
    );
    expect(res).toEqual({
      reviewId: 'rev-en-curso',
      status: 'RUNNING',
      reused: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  // ⚠️ El defecto que encontró la validación en vivo (2026-08-25). Un job que
  // el worker perdió —reinicio, o lock vencido porque el proveedor tardó más
  // que `lockDuration`— muere SIN pasar por el catch de `runReview`, que es lo
  // único que deja la fila en FAILED. Como el refresh se ENGANCHA a lo que
  // está RUNNING, el área quedaba bloqueada para siempre.
  //
  // Ningún test con mocks lo veía porque en un test el worker no se muere.
  it('una revisión colgada se cierra como FAILED y NO bloquea el área', async () => {
    const { prisma } = buildFakePrisma([]);
    const vieja = {
      id: 'rev-zombi',
      status: 'RUNNING',
      createdAt: new Date(Date.now() - 45 * 60_000), // 45 min > 30
    };
    prisma.documentReview.findFirst = jest.fn().mockResolvedValue(vieja);
    const queue = { add: jest.fn() };
    const service = new DocumentReviewService(
      prisma as any,
      buildConfig() as any,
      {} as any,
      queue as any,
    );

    const res = await service.startReview(
      'sector-ventas',
      'SALES' as any,
      'emp-1',
    );

    expect(res.reused).toBe(false);
    expect(res.reviewId).not.toBe('rev-zombi');
    expect(queue.add).toHaveBeenCalled();
    // Se cierra con motivo, no se borra en silencio: que se cayó es
    // información.
    expect(prisma.documentReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rev-zombi' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('una revisión reciente SÍ engancha: no se mata una corrida viva', async () => {
    const { prisma } = buildFakePrisma([]);
    prisma.documentReview.findFirst = jest.fn().mockResolvedValue({
      id: 'rev-viva',
      status: 'RUNNING',
      createdAt: new Date(Date.now() - 2 * 60_000), // 2 min
    });
    const queue = { add: jest.fn() };
    const service = new DocumentReviewService(
      prisma as any,
      buildConfig() as any,
      {} as any,
      queue as any,
    );

    const res = await service.startReview(
      'sector-ventas',
      'SALES' as any,
      'emp-1',
    );
    expect(res).toEqual({
      reviewId: 'rev-viva',
      status: 'RUNNING',
      reused: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('guarda el corte vigente con la corrida', async () => {
    const { prisma } = buildFakePrisma([]);
    const service = new DocumentReviewService(
      prisma as any,
      buildConfig({ DOC_REVIEW_SEVERITY_CUT: 75 }) as any,
      {} as any,
      { add: jest.fn() } as any,
    );
    await service.startReview('sector-ventas', 'SALES' as any, 'emp-1');
    expect(prisma.documentReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ severityCut: 75 }),
      }),
    );
  });
});

describe('DocumentReviewService — runReview', () => {
  it('cuenta como señalado solo lo que pasa el corte', async () => {
    const { service, reviews } = build(
      [doc('D1'), doc('D2')],
      [senala(85), senala(45)],
    );
    await service.runReview('rev-1');
    const rev = reviews[0];
    expect(rev.status).toBe('READY');
    expect(rev.documentsAnalyzed).toBe(2);
    expect(rev.findingsFound).toBe(1); // solo el de 85
  });

  // ⚠️ Se persiste TODO señalamiento aunque no pase el corte: la fila es el
  // registro de "este documento, en esta versión, ya se analizó". Sin eso los
  // ~66 documentos por debajo del corte se reanalizarían en cada corrida y el
  // incremental no incrementaría nada — que es la mitad de SC-008.
  it('persiste también los que quedan por debajo del corte', async () => {
    const { service, findings } = build(
      [doc('D1'), doc('D2')],
      [senala(85), senala(45)],
    );
    await service.runReview('rev-1');
    expect(findings.map((f) => f.severity).sort()).toEqual([45, 85]);
  });

  it('no persiste un señalamiento sin preguntas sin responder (FR-014)', async () => {
    const { service, findings } = build(
      [doc('D1')],
      [{ ...senala(90), unansweredQuestions: [] }],
    );
    await service.runReview('rev-1');
    expect(findings).toHaveLength(0);
  });

  // FR-013a: la primera corrida paga el costo entero; las siguientes no.
  it('saltea los documentos cuya versión ya se analizó', async () => {
    const { service, reviews, llm } = build(
      [doc('D1', 3), doc('D2', 1)],
      [senala(85)],
      [{ documentId: 'D1', documentVersion: 3 }],
    );
    await service.runReview('rev-1');
    expect(reviews[0].documentsAnalyzed).toBe(1);
    expect(reviews[0].documentsSkipped).toBe(1);
    expect(llm._invoke).toHaveBeenCalledTimes(1);
  });

  it('reanaliza un documento cuya versión cambió', async () => {
    const { service, reviews } = build(
      [doc('D1', 4)],
      [senala(85)],
      [{ documentId: 'D1', documentVersion: 3 }],
    );
    await service.runReview('rev-1');
    expect(reviews[0].documentsAnalyzed).toBe(1);
    expect(reviews[0].documentsSkipped).toBe(0);
  });

  // FR-017: una lista parcial se lee como si fuera todo lo que hay.
  it('un fallo deja la revisión FAILED con motivo, no a medias', async () => {
    const { prisma, reviews, findings } = buildFakePrisma([doc('D1')]);
    prisma.documentFinding.create = jest.fn((_args: any) =>
      Promise.reject(new Error('se cayó la base')),
    ) as any;
    const service = new DocumentReviewService(
      prisma as any,
      buildConfig() as any,
      llmStub([senala(85)]) as any,
      { add: jest.fn() } as any,
    );

    await service.runReview('rev-1');
    expect(reviews[0].status).toBe('FAILED');
    expect(reviews[0].failureReason).toContain('se cayó la base');
    expect(findings).toHaveLength(0);
  });

  // Que el modelo se caiga sobre UN documento no tumba la corrida entera: se
  // saltea ese y sigue. Cae la corrida solo si falla la persistencia.
  it('un fallo del modelo sobre un documento no tumba la corrida', async () => {
    const { service, reviews } = build([doc('D1')], new Error('429'));
    await service.runReview('rev-1');
    expect(reviews[0].status).toBe('READY');
    expect(reviews[0].findingsFound).toBe(0);
  });

  // Los transversales son 15 de los 75 activos: sin ellos serían el único
  // pedazo del corpus que nadie revisa nunca.
  it('los documentos transversales entran en la revisión del área', async () => {
    const { service, prisma } = build(
      [doc('D1'), doc('T1', 1, null)],
      [senala(85)],
    );
    await service.runReview('rev-1');
    expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ agentType: 'SALES' }, { agentType: null }],
        }),
      }),
    );
  });
});
