/**
 * Tests de la detección de higiene del corpus (spec 008, US1/US2).
 *
 * Dos garantías no negociables se prueban acá, no solo se documentan:
 *  - El prefiltro de área+audiencia (FR-002/FR-003, Principio I): una pareja
 *    que cruza cualquiera de los dos NUNCA sale del barrido.
 *  - "Ver no es editar" (FR-017): una pareja de área ajena se LISTA igual,
 *    solo se bloquea `fusionable`.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeHygieneService } from './knowledge-hygiene.service';

const THRESHOLD = 0.85;

function doc(
  id: string,
  overrides: Partial<{
    title: string;
    content: string;
    audience: string;
    agentType: string | null;
    version: number;
    isActive: boolean;
  }> = {},
) {
  return {
    id,
    title: overrides.title ?? `Doc ${id}`,
    content: overrides.content ?? `contenido de ${id}`,
    category: 'general',
    audience: overrides.audience ?? 'INTERNO',
    agentType:
      overrides.agentType === undefined ? 'SALES' : overrides.agentType,
    version: overrides.version ?? 1,
    isActive: overrides.isActive ?? true,
  };
}

function buildService(documentos: ReturnType<typeof doc>[]) {
  const prisma = {
    knowledgeDocument: {
      findMany: jest.fn().mockResolvedValue(documentos),
      count: jest.fn().mockResolvedValue(documentos.length),
    },
    knowledgeMergeDiscard: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    hygieneScan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'scan-1', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ where, data }) =>
          Promise.resolve({ id: where.id, ...data }),
        ),
    },
    hygienePair: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
    $transaction: jest.fn().mockImplementation(async (cb) => {
      const createManyData: unknown[] = [];
      const tx = {
        hygienePair: {
          createMany: jest.fn().mockImplementation(({ data }) => {
            createManyData.push(...data);
            return Promise.resolve({ count: data.length });
          }),
        },
        hygieneScan: {
          update: jest
            .fn()
            .mockImplementation(({ where, data }) =>
              Promise.resolve({ id: where.id, ...data }),
            ),
        },
      };
      const result = await cb(tx);
      (result as { __createManyData?: unknown[] }).__createManyData =
        createManyData;
      return result;
    }),
  };

  const searchResults = new Map<
    string,
    { documentId: string; title: string; content: string; score: number }[]
  >();
  const knowledge = {
    search: jest.fn().mockImplementation((content: string) => {
      // buscamos por contenido para no depender del orden de llamada
      const docFuente = documentos.find((d) => d.content === content);
      return Promise.resolve(
        docFuente ? (searchResults.get(docFuente.id) ?? []) : [],
      );
    }),
    assertPuedeEscribir: jest.fn().mockResolvedValue(undefined),
  };

  const usage = {
    forDocuments: jest.fn().mockResolvedValue(new Map()),
  };

  const config = {
    get: jest.fn().mockReturnValue(THRESHOLD),
  };

  const queue = { add: jest.fn().mockResolvedValue({}) };

  const service = new KnowledgeHygieneService(
    prisma as never,
    knowledge as never,
    usage as never,
    config as never,
    queue as never,
  );

  return { service, prisma, knowledge, usage, config, queue, searchResults };
}

describe('runScan — prefiltro de área y audiencia (FR-002/FR-003, SC-002)', () => {
  it('NUNCA propone una pareja de audiencias distintas, aunque el score sea altísimo', async () => {
    const a = doc('a', { audience: 'PUBLICO' });
    const b = doc('b', { audience: 'INTERNO' });
    const { service, searchResults } = buildService([a, b]);

    searchResults.set('a', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.99 },
    ]);
    searchResults.set('b', [
      { documentId: 'a', title: a.title, content: a.content, score: 0.99 },
    ]);

    const scan = await service.runScan('scan-1');

    expect(scan.pairsFound).toBe(0);
  });

  it('NUNCA propone una pareja de áreas distintas, aunque el score sea altísimo', async () => {
    const a = doc('a', { agentType: 'SALES' });
    const b = doc('b', { agentType: 'COLLECTIONS' });
    const { service, searchResults } = buildService([a, b]);

    searchResults.set('a', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.99 },
    ]);
    searchResults.set('b', [
      { documentId: 'a', title: a.title, content: a.content, score: 0.99 },
    ]);

    const scan = await service.runScan('scan-1');

    expect(scan.pairsFound).toBe(0);
  });

  it('SÍ propone la pareja cuando comparten área y audiencia, por encima del umbral', async () => {
    const a = doc('a');
    const b = doc('b');
    const { service, searchResults } = buildService([a, b]);

    searchResults.set('a', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.9 },
    ]);
    searchResults.set('b', [
      { documentId: 'a', title: a.title, content: a.content, score: 0.9 },
    ]);

    const scan = await service.runScan('scan-1');

    expect(scan.pairsFound).toBe(1);
  });
});

describe('runScan — consolidación de parejas (T014, edge case de más de una pareja)', () => {
  it('similitud asimétrica: se queda con el mejor score y con orden canónico', async () => {
    const a = doc('bbb'); // ids elegidos para forzar el orden alfabético
    const b = doc('aaa');
    const { service, prisma, searchResults } = buildService([a, b]);

    // a→b da 0.80, b→a da 0.90: el mejor de los dos tiene que ganar.
    searchResults.set('bbb', [
      { documentId: 'aaa', title: b.title, content: b.content, score: 0.8 },
    ]);
    searchResults.set('aaa', [
      { documentId: 'bbb', title: a.title, content: a.content, score: 0.9 },
    ]);

    await service.runScan('scan-1');

    const llamada = (prisma.$transaction as jest.Mock).mock.results[0].value;
    const filas = await llamada.then(
      (r: {
        __createManyData: {
          documentAId: string;
          documentBId: string;
          similarity: number;
        }[];
      }) => r.__createManyData,
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].documentAId).toBe('aaa'); // el de id menor
    expect(filas[0].documentBId).toBe('bbb');
    expect(filas[0].similarity).toBeCloseTo(90, 0); // el mejor de los dos, en escala 0-100
  });

  it('un documento en más de una pareja: aparecen las dos, ninguna excluye a la otra', async () => {
    const a = doc('a');
    const b = doc('b');
    const c = doc('c');
    const { service, prisma, searchResults } = buildService([a, b, c]);

    searchResults.set('a', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.9 },
    ]);
    searchResults.set('b', [
      { documentId: 'a', title: a.title, content: a.content, score: 0.9 },
      { documentId: 'c', title: c.title, content: c.content, score: 0.87 },
    ]);
    searchResults.set('c', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.87 },
    ]);

    await service.runScan('scan-1');

    const llamada = await (prisma.$transaction as jest.Mock).mock.results[0]
      .value;
    const claves = llamada.__createManyData.map(
      (f: { documentAId: string; documentBId: string }) =>
        `${f.documentAId}-${f.documentBId}`,
    );

    expect(claves).toContain('a-b');
    expect(claves).toContain('b-c');
    expect(claves).toHaveLength(2);
  });
});

describe('runScan — FR-005b: sin datos de comportamiento no vacía la lista', () => {
  it('una pareja con escalatedTurns: 0 igual se propone si supera el umbral', async () => {
    const a = doc('a');
    const b = doc('b');
    const { service, prisma, searchResults } = buildService([a, b]);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(0) }]);

    searchResults.set('a', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.9 },
    ]);
    searchResults.set('b', [
      { documentId: 'a', title: a.title, content: a.content, score: 0.9 },
    ]);

    const scan = await service.runScan('scan-1');

    expect(scan.pairsFound).toBe(1);
  });
});

describe('turnosEscaladosEnComun — cuenta turnos, no filas (research.md §6a)', () => {
  it('parsea el count de $queryRaw (bigint) a number', async () => {
    const { service, prisma } = buildService([doc('a'), doc('b')]);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(3) }]);

    const count = await (
      service as unknown as {
        turnosEscaladosEnComun: (a: string, b: string) => Promise<number>;
      }
    ).turnosEscaladosEnComun('a', 'b');

    expect(count).toBe(3);
  });

  it('la consulta deduplica por turno (DISTINCT), no cuenta filas del top-k repetidas', async () => {
    const { service, prisma } = buildService([doc('a'), doc('b')]);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(1) }]);

    await (
      service as unknown as {
        turnosEscaladosEnComun: (a: string, b: string) => Promise<number>;
      }
    ).turnosEscaladosEnComun('a', 'b');

    const [strings] = (prisma.$queryRaw as jest.Mock).mock.calls[0];
    const sql = strings.join('');
    expect(sql).toContain('DISTINCT');
    expect(sql).toContain('ESCALATED');
  });
});

describe('latestScan — los tres estados que no son error', () => {
  it('NEVER_RUN cuando no hay ninguna corrida', async () => {
    const { service, prisma } = buildService([]);
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValue(null);

    const res = await service.latestScan('emp-1');

    expect(res.status).toBe('NEVER_RUN');
    expect(res.pairs).toEqual([]);
  });

  it('RUNNING trae las parejas de la última corrida READY anterior, si existe', async () => {
    const { service, prisma } = buildService([]);
    const running = {
      id: 'scan-running',
      status: 'RUNNING',
      threshold: 85,
      documentsScanned: 0,
      pairsFound: 0,
      failureReason: null,
      createdAt: new Date(),
      finishedAt: null,
    };
    const ready = { ...running, id: 'scan-ready', status: 'READY' };

    (prisma.hygieneScan as { findFirst: jest.Mock }).findFirst
      .mockResolvedValueOnce(running) // la última corrida (en curso)
      .mockResolvedValueOnce(ready); // la última READY anterior

    const res = await service.latestScan('emp-1');

    expect(res.status).toBe('RUNNING');
    expect(prisma.hygienePair.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scanId: 'scan-ready' } }),
    );
  });

  it('FAILED trae failureReason y las parejas de la última READY, no error', async () => {
    const { service, prisma } = buildService([]);
    const failed = {
      id: 'scan-failed',
      status: 'FAILED',
      threshold: 85,
      documentsScanned: 30,
      pairsFound: 0,
      failureReason: 'Gemini devolvió 429',
      createdAt: new Date(),
      finishedAt: new Date(),
    };
    (prisma.hygieneScan as { findFirst: jest.Mock }).findFirst
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(null); // nunca hubo una READY antes

    const res = await service.latestScan('emp-1');

    expect(res.status).toBe('FAILED');
    expect((res as { failureReason?: string }).failureReason).toBe(
      'Gemini devolvió 429',
    );
    expect(res.pairs).toEqual([]);
  });
});

describe('startScan — 409 si ya hay un barrido corriendo', () => {
  it('rechaza un segundo barrido mientras el primero sigue RUNNING', async () => {
    const { service, prisma } = buildService([]);
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValue({
      id: 'scan-en-curso',
      status: 'RUNNING',
      createdAt: new Date(), // recién arrancado: no está colgado
    });

    await expect(service.startScan('emp-1')).rejects.toThrow(ConflictException);
  });

  // ⚠️ Tercera aparición del mismo defecto (documentos, cobertura, higiene).
  // Un barrido que quedó RUNNING porque el worker murió no vence solo, y el
  // 409 eterno deja el botón "Analizar" muerto para siempre. El encontrado en
  // vivo llevaba 38 HORAS. Ningún test lo veía porque en un test el worker no
  // se muere.
  it('un barrido colgado se cierra como FAILED y deja arrancar uno nuevo', async () => {
    const { service, prisma } = buildService([]);
    const hygieneScan = prisma.hygieneScan as {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    hygieneScan.findFirst.mockResolvedValue({
      id: 'scan-zombi',
      status: 'RUNNING',
      createdAt: new Date(Date.now() - 38 * 60 * 60_000), // 38 horas
    });

    const res = await service.startScan('emp-1');

    expect(res.scanId).not.toBe('scan-zombi');
    // Se cierra con motivo, no se borra en silencio.
    expect(hygieneScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'scan-zombi' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});

describe('pairsDeCorrida — FR-017, "ver no es editar"', () => {
  it('lista una pareja de área ajena con fusionable:false y motivo, sin excluirla', async () => {
    const a = doc('a', { agentType: 'COLLECTIONS' });
    const b = doc('b', { agentType: 'COLLECTIONS' });
    const { service, prisma, knowledge, usage } = buildService([a, b]);

    prisma.hygienePair.findMany = jest.fn().mockResolvedValue([
      {
        id: 'pair-1',
        similarity: 91,
        escalatedTurns: 0,
        documentA: a,
        documentB: b,
        createdAt: new Date(),
      },
    ]);
    usage.forDocuments.mockResolvedValue(
      new Map([
        ['a', { retrievedCount: 0, hasData: false }],
        ['b', { retrievedCount: 2, hasData: true }],
      ]),
    );
    knowledge.assertPuedeEscribir.mockRejectedValue(
      new ForbiddenException('Solo sos responsable de: Ventas'),
    );

    const res = await service.latestScan('emp-1');
    // fuerza el camino READY para ejercitar pairsDeCorrida directamente
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValueOnce({
      id: 'scan-1',
      status: 'READY',
      threshold: 85,
      documentsScanned: 2,
      pairsFound: 1,
      createdAt: new Date(),
      finishedAt: new Date(),
    });
    const resReady = await service.latestScan('emp-1');

    const pares = resReady.status === 'READY' ? resReady.pairs : res.pairs;
    expect(pares).toHaveLength(1);
    expect(pares[0].fusionable).toBe(false);
    expect(pares[0].motivoSiNo).toContain('Ventas');
  });
});

describe('discard — US2', () => {
  it('descartar dos veces la misma pareja ACTUALIZA el registro, no acumula filas', async () => {
    const a = doc('a', { version: 2 });
    const b = doc('b', { version: 5 });
    const { service, prisma } = buildService([a, b]);
    prisma.hygienePair.findUnique = jest.fn().mockResolvedValue({
      id: 'pair-1',
      documentAId: 'a',
      documentBId: 'b',
      documentA: a,
      documentB: b,
    });

    await service.discard('pair-1', 'primera vez', 'emp-1');
    // El documento A subió de versión entre medio (se editó y volvió a proponerse).
    const aNueva = { ...a, version: 3 };
    prisma.hygienePair.findUnique = jest.fn().mockResolvedValue({
      id: 'pair-1',
      documentAId: 'a',
      documentBId: 'b',
      documentA: aNueva,
      documentB: b,
    });
    await service.discard('pair-1', 'segunda vez', 'emp-1');

    expect(prisma.knowledgeMergeDiscard.upsert).toHaveBeenCalledTimes(2);
    const [primera, segunda] = (
      prisma.knowledgeMergeDiscard.upsert as jest.Mock
    ).mock.calls;
    // Las dos llamadas apuntan a LA MISMA fila (mismo `where`): un upsert sobre
    // @@unique([documentAId, documentBId]) actualiza, no inserta una segunda.
    expect(primera[0].where).toEqual(segunda[0].where);
    expect(segunda[0].update.versionA).toBe(3); // la versión nueva quedó registrada
  });

  it('descarta con las versiones vigentes de los dos documentos', async () => {
    const a = doc('a', { version: 2 });
    const b = doc('b', { version: 5 });
    const { service, prisma } = buildService([a, b]);
    prisma.hygienePair.findUnique = jest.fn().mockResolvedValue({
      id: 'pair-1',
      documentAId: 'a',
      documentBId: 'b',
      documentA: a,
      documentB: b,
    });

    await service.discard('pair-1', 'son casos distintos', 'emp-1');

    expect(prisma.knowledgeMergeDiscard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ versionA: 2, versionB: 5 }),
      }),
    );
  });

  it('403 si no es responsable del área (FR-012b)', async () => {
    const a = doc('a', { agentType: 'COLLECTIONS' });
    const b = doc('b', { agentType: 'COLLECTIONS' });
    const { service, prisma, knowledge } = buildService([a, b]);
    prisma.hygienePair.findUnique = jest.fn().mockResolvedValue({
      id: 'pair-1',
      documentAId: 'a',
      documentBId: 'b',
      documentA: a,
      documentB: b,
    });
    knowledge.assertPuedeEscribir.mockRejectedValue(
      new ForbiddenException('no'),
    );

    await expect(service.discard('pair-1', undefined, 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.knowledgeMergeDiscard.upsert).not.toHaveBeenCalled();
  });

  it('404 si la pareja no existe', async () => {
    const { service, prisma } = buildService([]);
    prisma.hygienePair.findUnique = jest.fn().mockResolvedValue(null);

    await expect(
      service.discard('inexistente', undefined, 'emp-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('un documento que cambió de versión: el descarte deja de aplicar y la pareja vuelve', async () => {
    const a = doc('a', { version: 2 });
    const b = doc('b', { version: 5 });
    const { service, prisma, searchResults } = buildService([a, b]);

    // Descarte vigente con versiones VIEJAS (el documento a ya subió a v3).
    (prisma.knowledgeMergeDiscard.findUnique as jest.Mock).mockResolvedValue({
      documentAId: 'a',
      documentBId: 'b',
      versionA: 1, // vieja
      versionB: 5,
    });

    searchResults.set('a', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.9 },
    ]);
    searchResults.set('b', [
      { documentId: 'a', title: a.title, content: a.content, score: 0.9 },
    ]);

    const scan = await service.runScan('scan-1');

    // versionA real (2) != versionA del descarte (1) → el descarte no aplica
    expect(scan.pairsFound).toBe(1);
  });

  it('un descarte vigente con las mismas versiones SÍ excluye la pareja', async () => {
    const a = doc('a', { version: 2 });
    const b = doc('b', { version: 5 });
    const { service, prisma, searchResults } = buildService([a, b]);

    (prisma.knowledgeMergeDiscard.findUnique as jest.Mock).mockResolvedValue({
      documentAId: 'a',
      documentBId: 'b',
      versionA: 2,
      versionB: 5,
    });

    searchResults.set('a', [
      { documentId: 'b', title: b.title, content: b.content, score: 0.9 },
    ]);
    searchResults.set('b', [
      { documentId: 'a', title: a.title, content: a.content, score: 0.9 },
    ]);

    const scan = await service.runScan('scan-1');

    expect(scan.pairsFound).toBe(0);
  });
});
