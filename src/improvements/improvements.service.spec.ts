import { ForbiddenException } from '@nestjs/common';
import { ImprovementsService } from './improvements.service';

/**
 * Tests de `ImprovementsService` con un Prisma "en memoria" para lo que esta
 * spec toca — mismo criterio que `interviews.service.spec.ts`: hace falta
 * comportamiento real (unión de fuentes, orden, filtrado), no solo "se llamó
 * con tal argumento".
 *
 * El armado puro (orden, deduplicación, tope) ya está probado en
 * `improvements-list.spec.ts`. Lo que se prueba acá es la plomería: que las
 * tres fuentes lleguen, que la autorización corte, y que el incremental no
 * vacíe la lista.
 */

function buildConfig(overrides: Record<string, number> = {}) {
  const values: Record<string, number> = {
    COVERAGE_THEME_OVERLAP: 0.5,
    IMPROVEMENT_MAX_ITEMS: 15,
    DOC_REVIEW_SEVERITY_CUT: 80,
    DOC_REVIEW_MAX_FINDINGS: 10,
    DOC_REVIEW_STALE_MINUTES: 30,
    INTERVIEW_MAX_ESCALATIONS_FALLBACK: 10,
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

function buildFakePrisma(over: any = {}) {
  return {
    sector: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sector-ventas',
        name: 'Ventas',
        agentType: 'SALES',
      }),
      findFirst: jest.fn().mockResolvedValue({ id: 'sector-ventas' }),
    },
    knowledgeDocument: {
      count: jest.fn().mockResolvedValue(22),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    orchestrationEvent: { findMany: jest.fn().mockResolvedValue([]) },
    escalation: { findMany: jest.fn().mockResolvedValue([]) },
    message: { findFirst: jest.fn().mockResolvedValue(null) },
    interviewCandidate: { findMany: jest.fn().mockResolvedValue([]) },
    interviewQuestion: { findMany: jest.fn().mockResolvedValue([]) },
    interviewSession: { findFirst: jest.fn().mockResolvedValue(null) },
    improvementDismissal: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    coverageThemeMark: { findMany: jest.fn().mockResolvedValue([]) },
    coverageScan: {
      findFirst: jest.fn().mockResolvedValue({ queriesConsidered: 25 }),
    },
    ...over,
  };
}

const knowledgeStub = () => ({
  esResponsableDeAgente: jest.fn().mockResolvedValue(true),
});

function coverageStub(temas: any[] = []) {
  return {
    getLatest: jest.fn().mockResolvedValue({
      scan: temas.length > 0 ? { id: 'scan-1' } : null,
      themes: temas,
      notice: null,
    }),
    hayScanCorriendo: jest.fn().mockResolvedValue(false),
    startScan: jest
      .fn()
      .mockResolvedValue({ scanId: 'scan-1', status: 'RUNNING' }),
  };
}

function reviewStub(findings: any[] = []) {
  return {
    startReview: jest.fn().mockResolvedValue({
      reviewId: 'rev-1',
      status: 'RUNNING',
      reused: false,
    }),
    ultimaRevision: jest.fn().mockResolvedValue({
      id: 'rev-0',
      finishedAt: new Date('2026-08-25'),
      createdAt: new Date('2026-08-25'),
      documentsAnalyzed: 0,
      documentsSkipped: 37,
    }),
    hayRevisionCorriendo: jest.fn().mockResolvedValue(false),
    senalamientosVigentes: jest.fn().mockResolvedValue(findings),
  };
}

function tema(i: number, queryCount = 3) {
  return {
    id: `theme-${i}`,
    label: `Tema ${i}`,
    agentType: 'SALES',
    band: 'SIN_RESPUESTA',
    cause: 'NO_HAY_NADA',
    queryEventIds: [`ev-${i}`],
    quotes: [`consulta ${i}`],
    queryCount,
    documents: [],
  };
}

function finding(
  docId: string,
  severity = 85,
  agentType: string | null = 'SALES',
) {
  return {
    documentId: docId,
    documentVersion: 1,
    severity,
    reason: 'el título promete algo que el cuerpo no cubre',
    unansweredQuestions: ['¿y si llega dañado?'],
    document: { title: `Documento ${docId}`, version: 1, agentType },
  };
}

function build(over: any = {}) {
  const prisma = over.prisma ?? buildFakePrisma();
  const knowledge = over.knowledge ?? knowledgeStub();
  const coverage = over.coverage ?? coverageStub();
  const review = over.review ?? reviewStub();
  const service = new ImprovementsService(
    prisma as any,
    (over.config ?? buildConfig()) as any,
    knowledge as any,
    coverage as any,
    review as any,
  );
  return { service, prisma, knowledge, coverage, review };
}

describe('ImprovementsService — autorización (SC-007)', () => {
  it('403 si no es responsable del área', async () => {
    const knowledge = {
      esResponsableDeAgente: jest.fn().mockResolvedValue(false),
    };
    const { service } = build({ knowledge });
    await expect(service.list('sector-ventas', 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('403 también al actualizar, no solo al mirar', async () => {
    const knowledge = {
      esResponsableDeAgente: jest.fn().mockResolvedValue(false),
    };
    const { service } = build({ knowledge });
    await expect(service.refresh('sector-ventas', 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('ImprovementsService — la lista unificada', () => {
  it('une las tres fuentes en una sola lista, con su procedencia', async () => {
    const { service } = build({
      coverage: coverageStub([tema(0)]),
      review: reviewStub([finding('D1')]),
      prisma: buildFakePrisma({
        escalation: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'E1',
              status: 'RESOLVED',
              resolution: 'se le repuso el producto',
              resolvedWithDocumentId: null,
              conversationId: 'c1',
              createdAt: new Date(),
            },
          ]),
        },
      }),
    });

    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.items.map((i) => i.source)).toEqual([
      'CONSULTA_FALLIDA',
      'ESCALADO',
      'DOCUMENTO_INCONCLUSO',
    ]);
  });

  // FR-011: preguntar donde dos documentos ya pelean agrega un tercero. Eso se
  // resuelve fusionando y tiene su propia pantalla.
  it('excluye los temas cuya causa son documentos que compiten', async () => {
    const compiten = { ...tema(0), cause: 'SE_COMPITEN' };
    const { service } = build({ coverage: coverageStub([compiten]) });
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.items).toHaveLength(0);
  });

  it('solo trae los temas del área elegida', async () => {
    const ajeno = { ...tema(1), agentType: 'COLLECTIONS' };
    const { service } = build({ coverage: coverageStub([tema(0), ajeno]) });
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0].title).toBe('Tema 0');
  });

  it('avisa que está trabajando mientras cualquiera de los dos análisis corre', async () => {
    const review = reviewStub();
    review.hayRevisionCorriendo = jest.fn().mockResolvedValue(true);
    const { service } = build({ review });
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.refreshing).toBe(true);
  });
});

describe('ImprovementsService — los tres notice no son intercambiables', () => {
  it('SIN_DOCUMENTOS cuando el área no tiene ninguno: no se ofrece revisar', async () => {
    const prisma = buildFakePrisma();
    prisma.knowledgeDocument.count = jest.fn().mockResolvedValue(0);
    const { service } = build({ prisma });
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.notice).toEqual({ code: 'SIN_DOCUMENTOS' });
  });

  it('SIN_REVISAR cuando nunca se actualizó', async () => {
    const review = reviewStub();
    review.ultimaRevision = jest.fn().mockResolvedValue(null);
    const { service } = build({ review });
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.notice).toEqual({ code: 'SIN_REVISAR' });
  });

  it('TODO_CUBIERTO cuando se revisó y no quedó nada', async () => {
    const { service } = build();
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.notice).toEqual({ code: 'TODO_CUBIERTO' });
  });

  it('sin notice cuando hay ítems', async () => {
    const { service } = build({ review: reviewStub([finding('D1')]) });
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.notice).toBeNull();
  });
});

describe('ImprovementsService — SC-003: sin tráfico, igual hay qué mejorar', () => {
  // El corazón de la feature. Cuatro de las cinco áreas no tienen tráfico
  // suficiente: sin esto la pantalla les queda vacía y la unificación no
  // resuelve nada.
  it('un área sin temas de cobertura ni escalados produce lista igual', async () => {
    const { service } = build({
      coverage: coverageStub([]),
      review: reviewStub([finding('D1'), finding('D2', 82)]),
    });

    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.items).toHaveLength(2);
    expect(res.items.every((i) => i.source === 'DOCUMENTO_INCONCLUSO')).toBe(
      true,
    );
    // SC-004: cero señalamientos que digan solo "está incompleto".
    expect(
      res.items.every((i) => (i.unansweredQuestions ?? []).length > 0),
    ).toBe(true);
  });
});

describe('ImprovementsService — los transversales (FR-024/SC-009)', () => {
  // Un ítem que quien lo ve no puede corregir es un ítem sin acción detrás.
  it('un señalamiento transversal NO se muestra a quien solo tiene un área', async () => {
    const knowledge = {
      esResponsableDeAgente: jest.fn(
        async (_id: string, agentType: unknown) => agentType !== null,
      ),
    };
    const { service } = build({
      knowledge,
      review: reviewStub([finding('T1', 85, null)]),
    });

    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.items).toHaveLength(0);
  });

  it('sí se muestra a quien es responsable de todas las áreas', async () => {
    const { service } = build({
      review: reviewStub([finding('T1', 85, null)]),
    });
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0].document?.esTransversal).toBe(true);
  });
});

describe('ImprovementsService — la entrevista sin cerrar', () => {
  // ⚠️ Desde que se retiró la pestaña "Entrevista", esta pantalla es la única
  // puerta. Sin este dato, una sesión con fichas esperando aprobación queda
  // INALCANZABLE en cuanto la lista se vacía — que es lo que pasa siempre,
  // porque abrir la entrevista consume los ítems. Visto en el panel.
  it('la expone aunque la lista esté vacía', async () => {
    const prisma = buildFakePrisma();
    prisma.interviewSession.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'sess-1', status: 'EN_REVISION' });
    const { service } = build({ prisma });

    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.items).toHaveLength(0);
    expect(res.openSession).toEqual({ id: 'sess-1', status: 'EN_REVISION' });
  });

  it('null cuando no hay ninguna', async () => {
    const { service } = build();
    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.openSession).toBeNull();
  });
});

describe('ImprovementsService — refresh (FR-005a/FR-018)', () => {
  it('una sola acción dispara los dos análisis', async () => {
    const { service, coverage, review } = build();
    const res = await service.refresh('sector-ventas', 'emp-1');
    expect(coverage.startScan).toHaveBeenCalled();
    expect(review.startReview).toHaveBeenCalled();
    expect(res.coverage.reused).toBe(false);
  });

  // El barrido es global: dispararlo desde dos áreas a la vez engancha al que
  // ya está corriendo en vez de arrancar otro. No es un error, es el diseño.
  it('se engancha al barrido en curso en vez de arrancar otro', async () => {
    const coverage = coverageStub();
    coverage.startScan = jest.fn().mockRejectedValue({
      getResponse: () => ({
        reason: 'SCAN_ALREADY_RUNNING',
        scanId: 'scan-en-curso',
      }),
    });
    const { service } = build({ coverage });

    const res = await service.refresh('sector-ventas', 'emp-1');
    expect(res.coverage).toEqual({
      scanId: 'scan-en-curso',
      status: 'RUNNING',
      reused: true,
    });
  });

  // ⚠️ Un 409 acá cancelaría también el barrido de cobertura, que sí podía
  // arrancar. Por eso se engancha en vez de rechazar.
  it('la revisión de documentos en curso NO tumba el refresh entero', async () => {
    const review = reviewStub();
    review.startReview = jest.fn().mockResolvedValue({
      reviewId: 'rev-en-curso',
      status: 'RUNNING',
      reused: true,
    });
    const { service } = build({ review });

    const res = await service.refresh('sector-ventas', 'emp-1');
    expect(res.documents.reused).toBe(true);
    expect(res.coverage.scanId).toBe('scan-1');
  });
});

describe('ImprovementsService — el incremental no vacía la lista', () => {
  // ⚠️ El caso que protege la tercera fuente. Con FR-013a una segunda corrida
  // puede saltear TODO y analizar cero documentos: si la lista se armara con
  // "los findings de la última revisión", devolvería cero y la pantalla se
  // vaciaría. Se arma con los señalamientos VIGENTES por documento.
  it('una revisión que analizó 0 documentos devuelve la misma lista que la primera', async () => {
    const findings = [finding('D1'), finding('D2', 82)];
    const review = reviewStub(findings);
    review.ultimaRevision = jest.fn().mockResolvedValue({
      id: 'rev-2',
      finishedAt: new Date(),
      createdAt: new Date(),
      documentsAnalyzed: 0, // no se analizó NADA
      documentsSkipped: 37,
    });
    const { service } = build({ review });

    const res = await service.list('sector-ventas', 'emp-1');
    expect(res.lastRefresh?.documentsAnalyzed).toBe(0);
    expect(res.items).toHaveLength(2);
  });
});

describe('ImprovementsService — el material de la entrevista', () => {
  it('con itemId, ese ítem va primero', async () => {
    const { service } = build({
      coverage: coverageStub([tema(0)]),
      review: reviewStub([finding('D1')]),
    });

    const { material } = await service.materialParaEntrevista(
      'sector-ventas',
      'SALES' as any,
      'emp-1',
      'doc:D1',
    );
    expect(material[0].origin).toBe('DOCUMENTO_INCONCLUSO');
  });

  it('sin itemId, respeta el orden de la lista', async () => {
    const { service } = build({
      coverage: coverageStub([tema(0)]),
      review: reviewStub([finding('D1')]),
    });

    const { material } = await service.materialParaEntrevista(
      'sector-ventas',
      'SALES' as any,
      'emp-1',
    );
    expect(material[0].origin).toBe('TEMA_COBERTURA');
  });

  it('distingue "no había nada" de "ya se preguntó todo"', async () => {
    const { service } = build();
    const vacio = await service.materialParaEntrevista(
      'sector-ventas',
      'SALES' as any,
      'emp-1',
    );
    expect(vacio.huboItems).toBe(false);
  });
});
