import { ConflictException, BadRequestException } from '@nestjs/common';
import { KnowledgeCoverageService } from './knowledge-coverage.service';

/**
 * Tests de `KnowledgeCoverageService` con un Prisma "en memoria": las tablas
 * de esta spec (`CoverageScan`, `CoverageTheme`, `CoverageThemeMark`,
 * `OrchestrationEvent`) se simulan con arrays reales para poder verificar
 * comportamiento (ventana, orden, truncado) y no solo "se llamó con tal
 * argumento". Las tablas de otras specs (higiene, documentos, escalaciones,
 * sectores) van con mocks simples: ya están cubiertas en vivo (quickstart) y
 * acá solo hace falta que no rompan la tubería.
 *
 * El pipeline completo (schema real, Postgres real, Gemini real) se validó
 * en vivo durante la implementación — incluido el bug de "reincidente" que
 * este archivo also cubre en forma de test (antes solo se veía corriendo la
 * app). Estos tests son la red que evita que vuelva.
 */

interface FakeEvent {
  id: string;
  conversationId: string | null;
  agentType: string | null;
  eventType: string;
  createdAt: Date;
  payload: Record<string, unknown>;
}

function buildFakePrisma(events: FakeEvent[]) {
  const scans: any[] = [];
  const themes: any[] = [];
  const themeDocs: any[] = [];
  const marks: any[] = [];
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const prisma = {
    orchestrationEvent: {
      count: jest.fn(({ where }: any) =>
        Promise.resolve(
          events.filter(
            (e) =>
              e.eventType === where.eventType &&
              e.agentType !== null &&
              e.createdAt >= where.createdAt.gte &&
              e.createdAt < where.createdAt.lt,
          ).length,
        ),
      ),
      findMany: jest.fn(({ where, orderBy, take, select }: any) => {
        let rows = events.filter((e) => {
          if (where.id?.in) return where.id.in.includes(e.id);
          return (
            e.eventType === where.eventType &&
            (where.agentType ? e.agentType !== null : true) &&
            (!where.createdAt ||
              (e.createdAt >= where.createdAt.gte &&
                e.createdAt < where.createdAt.lt))
          );
        });
        if (orderBy?.createdAt === 'desc') {
          rows = [...rows].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        }
        if (take) rows = rows.slice(0, take);
        if (
          select?.payload === undefined &&
          select?.conversationId &&
          Object.keys(select).length === 1
        ) {
          return Promise.resolve(
            rows.map((r) => ({ conversationId: r.conversationId })),
          );
        }
        if (select?.createdAt && Object.keys(select).length === 2) {
          return Promise.resolve(
            rows.map((r) => ({ id: r.id, createdAt: r.createdAt })),
          );
        }
        return Promise.resolve(rows);
      }),
    },
    coverageScan: {
      findFirst: jest.fn(({ where }: any) => {
        let rows = scans;
        if (where?.status) rows = rows.filter((s) => s.status === where.status);
        if (where?.id?.not) rows = rows.filter((s) => s.id !== where.id.not);
        // Orden por secuencia de creación, no por `createdAt.getTime()`: dos
        // scans creados en el mismo test pueden caer en el mismo milisegundo
        // (`Date` no tiene más resolución que esa), y ahí un sort por fecha
        // empata — Postgres no tiene ese problema (created_at ahí SÍ alcanza
        // para el volumen real), pero el fake sí, y un empate roto para el
        // lado equivocado hacía flaky el test de "reincidente".
        rows = [...rows].sort((a, b) => b._seq - a._seq);
        return Promise.resolve(rows[0] ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        const id = nextId('scan');
        const scan = {
          id,
          _seq: idCounter,
          createdAt: new Date(),
          finishedAt: null,
          ...data,
        };
        scans.push(scan);
        return Promise.resolve(scan);
      }),
      update: jest.fn(({ where, data }: any) => {
        const scan = scans.find((s) => s.id === where.id);
        Object.assign(scan, data);
        return Promise.resolve(scan);
      }),
      findUniqueOrThrow: jest.fn(({ where }: any) => {
        const scan = scans.find((s) => s.id === where.id);
        if (!scan) throw new Error('scan not found');
        return Promise.resolve(scan);
      }),
    },
    coverageTheme: {
      create: jest.fn(({ data }: any) => {
        const { documents, ...rest } = data;
        const theme = { id: nextId('theme'), createdAt: new Date(), ...rest };
        themes.push(theme);
        (documents?.create ?? []).forEach((d: any) =>
          themeDocs.push({ id: nextId('themedoc'), themeId: theme.id, ...d }),
        );
        return Promise.resolve(theme);
      }),
      findMany: jest.fn(({ where, orderBy }: any) => {
        let rows = themes.filter((t) => t.scanId === where.scanId);
        if (orderBy?.queryCount === 'desc') {
          rows = [...rows].sort((a, b) => b.queryCount - a.queryCount);
        }
        return Promise.resolve(
          rows.map((t) => ({
            ...t,
            documents: themeDocs
              .filter((d) => d.themeId === t.id)
              .map((d) => ({
                ...d,
                document: {
                  id: d.documentId,
                  title: `Doc ${d.documentId}`,
                  isActive: true,
                  version: d.version,
                },
              })),
            mark: marks.find((m) => m.themeId === t.id)
              ? {
                  markedAt: marks.find((m) => m.themeId === t.id).markedAt,
                  markedBy: { id: 'emp-1', name: 'Diego' },
                }
              : null,
          })),
        );
      }),
      findUniqueOrThrow: jest.fn(({ where }: any) => {
        const t = themes.find((x) => x.id === where.id);
        if (!t) throw new Error('theme not found');
        return Promise.resolve(t);
      }),
      // distinct label query (fetchPreviousLabels)
      // reutiliza findMany si distinct viene en el where
    },
    coverageThemeMark: {
      findMany: jest.fn(({ where }: any) => {
        const excluded = where?.theme?.scanId?.not;
        return Promise.resolve(
          marks
            .filter((m) => {
              const t = themes.find((x) => x.id === m.themeId);
              return t && (!excluded || t.scanId !== excluded);
            })
            .map((m) => {
              const t = themes.find((x) => x.id === m.themeId)!;
              return {
                markedAt: m.markedAt,
                markedBy: { id: m.markedById, name: 'Diego' },
                theme: { id: t.id, queryEventIds: t.queryEventIds },
              };
            }),
        );
      }),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(marks.find((m) => m.themeId === where.themeId) ?? null),
      ),
      create: jest.fn(({ data }: any) => {
        const mark = { id: nextId('mark'), markedAt: new Date(), ...data };
        marks.push(mark);
        return Promise.resolve(mark);
      }),
      delete: jest.fn(({ where }: any) => {
        const i = marks.findIndex((m) => m.themeId === where.themeId);
        // Igual que Prisma real (P2025): sin fila que borrar, se rechaza en
        // vez de `splice(-1, 1)`, que borraría el ÚLTIMO elemento del array
        // por accidente — el mismo tipo de silencio que causó el bug real.
        if (i === -1) {
          return Promise.reject(new Error('No record was found for a delete.'));
        }
        marks.splice(i, 1);
        return Promise.resolve({});
      }),
    },
    hygieneScan: { findFirst: jest.fn().mockResolvedValue(null) },
    hygienePair: { findMany: jest.fn().mockResolvedValue([]) },
    knowledgeDocument: { findMany: jest.fn().mockResolvedValue([]) },
    escalation: { findMany: jest.fn().mockResolvedValue([]) },
    sector: { findFirst: jest.fn().mockResolvedValue(null) },
    employee: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ areasSupervisadas: [] }),
    },
  };

  return { prisma, scans, themes, marks };
}

function buildConfig(overrides: Record<string, number> = {}) {
  const values: Record<string, number> = {
    RAG_CONFIDENCE_THRESHOLD: 0.65,
    COVERAGE_WINDOW_DAYS: 30,
    COVERAGE_NOISE_FLOOR: 54.3,
    COVERAGE_MARGINAL_BAND: 5,
    COVERAGE_MIN_QUERIES_PER_THEME: 2,
    COVERAGE_MAX_QUERIES_PER_SCAN: 300,
    COVERAGE_THEME_OVERLAP: 0.5,
    COVERAGE_MAX_QUOTES_PER_THEME: 3,
    COVERAGE_SCAN_MIN_QUERIES: 2,
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

function ev(
  id: string,
  message: string,
  score: number,
  createdAt: Date,
): FakeEvent {
  return {
    id,
    conversationId: `conv-${id}`,
    agentType: 'SALES',
    eventType: 'ROUTED_TO_AGENT',
    createdAt,
    payload: {
      message,
      confidence: score / 100,
      escalated: false,
      candidates: [{ documentId: `doc-${id}`, score, rank: 0 }],
    },
  };
}

function buildQueue() {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

function buildGroupingAllTogether() {
  return {
    group: jest.fn((queries: { id: string; text: string }[]) =>
      Promise.resolve(
        queries.length >= 1
          ? {
              themes: [
                {
                  label: 'Tema único',
                  queryIds: queries.map((q) => q.id),
                  esPreguntaDeConocimiento: true,
                },
              ],
              sinAgrupar: [],
            }
          : { themes: [], sinAgrupar: [] },
      ),
    ),
  };
}

const knowledgeStub = {
  esResponsableDeAgente: jest.fn().mockResolvedValue(true),
};

describe('KnowledgeCoverageService — startScan', () => {
  it('409 si ya hay una corrida RUNNING, con su scanId', async () => {
    const { prisma } = buildFakePrisma([]);
    prisma.coverageScan.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'scan-en-curso', status: 'RUNNING' });
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );

    await expect(service.startScan('emp-1')).rejects.toThrow(ConflictException);
  });

  it('FR-025: windowFrom >= windowTo → 400', async () => {
    const { prisma } = buildFakePrisma([]);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );
    const from = new Date('2026-08-10');
    const to = new Date('2026-08-01'); // antes que from

    await expect(service.startScan('emp-1', from, to)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('FR-025: windowTo en el futuro se acota a ahora, con aviso', async () => {
    const { prisma } = buildFakePrisma([]);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );
    const futuro = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    const result = await service.startScan('emp-1', undefined, futuro);

    expect(result.truncatedWindow).toBe(true);
    expect(result.windowTo.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('sin ventana explícita, usa COVERAGE_WINDOW_DAYS', async () => {
    const { prisma } = buildFakePrisma([]);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig({ COVERAGE_WINDOW_DAYS: 7 }) as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );

    const result = await service.startScan('emp-1');
    const spanDays =
      (result.windowTo.getTime() - result.windowFrom.getTime()) / 86400000;
    expect(spanDays).toBeCloseTo(7, 5);
  });
});

describe('KnowledgeCoverageService — runScan (pipeline con Prisma en memoria)', () => {
  const now = new Date('2026-08-24T00:00:00Z');
  const dentro = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
  const fuera = new Date('2026-01-01T00:00:00Z'); // muy anterior a la ventana

  it('la ventana excluye turnos viejos: solo cuenta los que caen dentro', async () => {
    const events = [
      ev('e1', 'consulta reciente uno', 40, dentro(1)),
      ev('e2', 'consulta reciente dos', 42, dentro(2)),
      ev('e-vieja', 'consulta vieja fuera de ventana', 30, fuera),
    ];
    const { prisma, scans } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );

    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    const actualizado = scans.find((s) => s.id === scan.id);
    expect(actualizado.queriesConsidered).toBe(2); // NO cuenta e-vieja
    expect(actualizado.status).toBe('READY');
  });

  it('turnos triviales y de audio no entran (la query solo pide ROUTED_TO_AGENT)', async () => {
    const events = [
      ev('e1', 'consulta uno', 40, dentro(1)),
      ev('e2', 'consulta dos', 42, dentro(1)),
      { ...ev('e3', 'hola', 0, dentro(1)), eventType: 'TRIVIAL_RESPONSE' },
      {
        ...ev('e4', '__AUDIO_NO_TRANSCRIBIBLE__', 0, dentro(1)),
        eventType: 'AUDIO_NOT_TRANSCRIBED',
      },
    ];
    const { prisma, scans } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    expect(scans.find((s) => s.id === scan.id).queriesConsidered).toBe(2);
  });

  it('tope de volumen: marca truncated: true cuando hay más turnos que el cap', async () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev(`e${i}`, `consulta ${i}`, 40, dentro(i + 1)),
    );
    const { prisma, scans } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig({ COVERAGE_MAX_QUERIES_PER_SCAN: 3 }) as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    const actualizado = scans.find((s) => s.id === scan.id);
    expect(actualizado.truncated).toBe(true);
    expect(actualizado.queriesConsidered).toBe(3); // el cap, no el total real
  });

  it('FR-003a: por debajo de COVERAGE_SCAN_MIN_QUERIES no agrupa (0 temas) y no llama al agrupador', async () => {
    const events = [ev('e1', 'única consulta', 40, dentro(1))];
    const { prisma, scans } = buildFakePrisma(events);
    const grouping = buildGroupingAllTogether();
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig({ COVERAGE_SCAN_MIN_QUERIES: 5 }) as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    expect(grouping.group).not.toHaveBeenCalled();
    expect(scans.find((s) => s.id === scan.id).themesFound).toBe(0);
  });

  it('looseQueries: una consulta de interés que no se agrupa con nada se cuenta, no desaparece', async () => {
    const grouping = {
      group: jest
        .fn()
        .mockResolvedValue({ themes: [], sinAgrupar: ['e1', 'e2'] }),
    };
    const events = [
      ev('e1', 'consulta suelta uno', 40, dentro(1)),
      ev('e2', 'consulta suelta dos', 42, dentro(1)),
    ];
    const { prisma, scans } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    const actualizado = scans.find((s) => s.id === scan.id);
    expect(actualizado.looseQueries).toBe(2);
    expect(actualizado.themesFound).toBe(0);
  });

  it('temas ordenados por queryCount descendente (FR-005), no alfabético', async () => {
    const grouping = {
      group: jest.fn().mockResolvedValue({
        themes: [
          {
            label: 'Z tema chico',
            queryIds: ['e1', 'e2'],
            esPreguntaDeConocimiento: true,
          },
          {
            label: 'A tema grande',
            queryIds: ['e3', 'e4', 'e5'],
            esPreguntaDeConocimiento: true,
          },
        ],
        sinAgrupar: [],
      }),
    };
    const events = [
      ev('e1', 'uno', 40, dentro(1)),
      ev('e2', 'dos', 40, dentro(1)),
      ev('e3', 'tres', 40, dentro(1)),
      ev('e4', 'cuatro', 40, dentro(1)),
      ev('e5', 'cinco', 40, dentro(1)),
    ];
    const { prisma } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    const latest = await service.getLatest('emp-1');
    expect(latest.themes.map((t: any) => t.label)).toEqual([
      'A tema grande',
      'Z tema chico',
    ]);
  });

  it('FR-009: las citas no traen ningún identificador de quién preguntó', async () => {
    const events = [
      ev('e1', 'consulta con texto de cliente', 40, dentro(1)),
      ev('e2', 'otra consulta similar', 42, dentro(1)),
    ];
    const { prisma } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      buildGroupingAllTogether() as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    const latest = await service.getLatest('emp-1');
    const json = JSON.stringify(latest.themes);
    expect(json).not.toContain('conv-e1');
    expect(json).not.toContain('conversationId');
    expect(latest.themes[0].quotes).toEqual(
      expect.arrayContaining([
        'consulta con texto de cliente',
        'otra consulta similar',
      ]),
    );
  });

  it('un fallo durante la corrida deja el scan en FAILED con failureReason, no READY a medias', async () => {
    const grouping = {
      group: jest.fn().mockRejectedValue(new Error('nunca debería llegar acá')),
    };
    const events = [
      ev('e1', 'uno', 40, dentro(1)),
      ev('e2', 'dos', 40, dentro(1)),
    ];
    const { prisma, scans } = buildFakePrisma(events);
    // Forzar el fallo en un punto posterior al chequeo de mínimo: hace falta
    // una corrida de higiene READY para que el código llegue a preguntarle
    // sus parejas (si no hay corrida, `fetchOpenHygienePairs` corta antes).
    prisma.hygieneScan.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'hyg-scan-1', status: 'READY' });
    prisma.hygienePair.findMany = jest
      .fn()
      .mockRejectedValue(new Error('DB caída'));
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });

    await expect(service.runScan(scan.id)).rejects.toThrow('DB caída');

    const actualizado = scans.find((s) => s.id === scan.id);
    expect(actualizado.status).toBe('FAILED');
    expect(actualizado.failureReason).toBe('DB caída');
  });
});

describe('KnowledgeCoverageService — atendido y reaparición (FR-026/027/028, T031)', () => {
  const now = new Date('2026-08-24T00:00:00Z');
  const dentro = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  async function runOnce(prisma: any, grouping: any, config = buildConfig()) {
    const service = new KnowledgeCoverageService(
      prisma as any,
      config as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);
    return { service, scan };
  }

  it('un tema marcado, sin tráfico nuevo, no vuelve a aparecer en la corrida siguiente', async () => {
    const events = [
      ev('e1', 'tema repetido', 40, dentro(48)),
      ev('e2', 'tema repetido variante', 42, dentro(48)),
    ];
    const grouping = buildGroupingAllTogether();
    const { prisma } = buildFakePrisma(events);

    const { service } = await runOnce(prisma, grouping);
    const primeraCorrida = await service.getLatest('emp-1');
    expect(primeraCorrida.themes).toHaveLength(1);

    await service.markHandled(primeraCorrida.themes[0].id, 'emp-1');

    // Segunda corrida: MISMOS eventos, sin tráfico nuevo.
    const scan2 = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan2.id);

    const segundaCorrida = await service.getLatest('emp-1');
    expect(segundaCorrida.themes).toHaveLength(0); // oculto
  });

  it('un tema marcado, CON tráfico nuevo posterior a la marca, reaparece marcado como reincidente', async () => {
    const events = [
      ev('e1', 'tema repetido', 40, dentro(48)),
      ev('e2', 'tema repetido variante', 42, dentro(48)),
    ];
    const grouping = buildGroupingAllTogether();
    const { prisma } = buildFakePrisma(events);

    const { service } = await runOnce(prisma, grouping);
    const primeraCorrida = await service.getLatest('emp-1');
    const marca = await service.markHandled(
      primeraCorrida.themes[0].id,
      'emp-1',
    );

    // Tráfico nuevo posterior a la marca: se agregan 2 eventos frescos, con
    // timestamp explícitamente POSTERIOR al de la marca (no `new Date()` a
    // secas: dos llamadas seguidas pueden caer en el mismo milisegundo y
    // `hayTraficoNuevo` usa `>` estricto — un empate se leería como "sin
    // tráfico nuevo" y el test sería frágil).
    // Margen de un día entero, no milisegundos: el punto del test es
    // "hay tráfico posterior a la marca", no afinar un empate de reloj.
    // Un margen angosto against el reloj real hizo esto flaky (`markedAt`
    // sale de `new Date()` real dentro del servicio, no de `now`/`dentro`
    // —que son sintéticos—, así que un colchón de segundos podía comerse
    // el jitter real de ejecución del test).
    const UN_DIA_MS = 24 * 60 * 60 * 1000;
    const despuesDeLaMarca = new Date(marca.markedAt.getTime() + UN_DIA_MS);
    events.push(ev('e3', 'tema repetido de nuevo', 41, despuesDeLaMarca));
    events.push(ev('e4', 'tema repetido otra vez', 43, despuesDeLaMarca));

    const ventanaHasta = new Date(despuesDeLaMarca.getTime() + UN_DIA_MS);
    const scan2 = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: ventanaHasta,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan2.id);

    const segundaCorrida = await service.getLatest('emp-1');
    expect(segundaCorrida.themes).toHaveLength(1);
    expect(segundaCorrida.themes[0].handled).toMatchObject({ recurring: true });
    expect(segundaCorrida.themes[0].handled.markedBy).toBeDefined();
  });
});

describe('KnowledgeCoverageService — banda AL_LIMITE, conteos separados (US3, FR-022/FR-023, T041)', () => {
  const now = new Date('2026-08-24T00:00:00Z');
  const dentro = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  it('un grupo del LLM con consultas en las dos bandas se persiste como DOS temas — mismo label, queryCount por separado, sin sumarse', async () => {
    // e1/e2: SIN_RESPUESTA (score 30, bajo el piso 54.3). e3/e4: AL_LIMITE
    // (score 67, entre el umbral 65 y el margen 70). El agrupador los junta
    // a los cuatro bajo UN solo label — es plausible: mismo tema, distinta
    // suerte según qué candidato encontró cada consulta puntual.
    const events = [
      ev('e1', 'garantía uno', 30, dentro(1)),
      ev('e2', 'garantía dos', 32, dentro(1)),
      ev('e3', 'garantía tres', 67, dentro(1)),
      ev('e4', 'garantía cuatro', 68, dentro(1)),
    ];
    const grouping = {
      group: jest.fn().mockResolvedValue({
        themes: [
          {
            label: 'Garantía de productos',
            queryIds: ['e1', 'e2', 'e3', 'e4'],
            esPreguntaDeConocimiento: true,
          },
        ],
        sinAgrupar: [],
      }),
    };
    const { prisma } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);

    const latest = await service.getLatest('emp-1');
    expect(latest.themes).toHaveLength(2);

    const sinRespuesta = latest.themes.find(
      (t: any) => t.band === 'SIN_RESPUESTA',
    );
    const alLimite = latest.themes.find((t: any) => t.band === 'AL_LIMITE');

    expect(sinRespuesta.label).toBe('Garantía de productos');
    expect(alLimite.label).toBe('Garantía de productos'); // mismo tema, dos filas
    expect(sinRespuesta.queryCount).toBe(2);
    expect(alLimite.queryCount).toBe(2);
    // Ningún campo los suma en un total único (FR-023): son dos objetos
    // separados, cada uno con SU conteo — no hay un "4" en ningún lado.
    expect(sinRespuesta.queryCount + alLimite.queryCount).toBe(4);
    expect(alLimite.cause).toBeNull();
    // Banda y causa siguen siendo ejes distintos, pero la ACCIÓN ya no es
    // "ninguna": hay un documento detrás y contestó raspando, así que se
    // propone corregirlo — el mismo veredicto que la entrevista (spec 010).
    expect(alLimite.action).toBe('CORREGIR_DOCUMENTO');
    expect(sinRespuesta.cause).not.toBeNull();
  });
});

describe('KnowledgeCoverageService — unmarkHandled', () => {
  const now = new Date('2026-08-24T00:00:00Z');
  const dentro = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  it('con marca propia, desmarca sin problema', async () => {
    const events = [
      ev('e1', 'uno', 40, dentro(1)),
      ev('e2', 'dos', 40, dentro(1)),
    ];
    const grouping = buildGroupingAllTogether();
    const { prisma, marks } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan.id);
    const latest = await service.getLatest('emp-1');
    await service.markHandled(latest.themes[0].id, 'emp-1');
    expect(marks).toHaveLength(1);

    const result = await service.unmarkHandled(latest.themes[0].id, 'emp-1');

    expect(result).toEqual({ unmarked: true });
    expect(marks).toHaveLength(0);
  });

  it('BUG REAL (encontrado en vivo): un tema reincidente sin marca propia da 404 explicativo, no un 500 de Prisma sin capturar', async () => {
    // Reproduce exactamente el caso real: marcar, generar tráfico nuevo,
    // correr de nuevo (nace un tema NUEVO que reconoce la marca por solape
    // pero no la tiene puesta encima), e intentar desmarcar ESE tema nuevo.
    const events = [
      ev('e1', 'tema repetido', 40, dentro(48)),
      ev('e2', 'tema repetido variante', 42, dentro(48)),
    ];
    const grouping = buildGroupingAllTogether();
    const { prisma } = buildFakePrisma(events);
    const service = new KnowledgeCoverageService(
      prisma as any,
      buildConfig() as any,
      buildQueue() as any,
      grouping as any,
      knowledgeStub as any,
    );
    const scan1 = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: now,
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan1.id);
    const primeraCorrida = await service.getLatest('emp-1');
    await service.markHandled(primeraCorrida.themes[0].id, 'emp-1');

    const UN_DIA_MS = 24 * 60 * 60 * 1000;
    const marca = await prisma.coverageThemeMark.findUnique({
      where: { themeId: primeraCorrida.themes[0].id },
    });
    const despuesDeLaMarca = new Date(marca.markedAt.getTime() + UN_DIA_MS);
    events.push(ev('e3', 'tema repetido de nuevo', 41, despuesDeLaMarca));
    events.push(ev('e4', 'tema repetido otra vez', 43, despuesDeLaMarca));

    const scan2 = await prisma.coverageScan.create({
      data: {
        status: 'RUNNING',
        windowFrom: dentro(24 * 30),
        windowTo: new Date(despuesDeLaMarca.getTime() + UN_DIA_MS),
        noiseFloor: 54.3,
        threshold: 65,
        marginalBand: 5,
        startedById: 'emp-1',
      },
    });
    await service.runScan(scan2.id);
    const segundaCorrida = await service.getLatest('emp-1');
    expect(segundaCorrida.themes[0].handled.recurring).toBe(true); // precondición

    await expect(
      service.unmarkHandled(segundaCorrida.themes[0].id, 'emp-1'),
    ).rejects.toThrow('no tiene una marca propia');
  });
});
