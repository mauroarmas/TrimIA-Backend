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
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    hygieneScan: {
      findFirst: jest.fn().mockResolvedValue(null),
      // Lo usa `latestScan` para releer una corrida que acaba de cerrar por
      // colgada. Sin él, el fake no puede representar el paso de RUNNING a
      // FAILED que ocurre DENTRO de la lectura.
      findUnique: jest.fn().mockResolvedValue(null),
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

  /**
   * ⚠️ Distingue por CLAVE, y no es cosmética.
   *
   * Devolvía `THRESHOLD` (0.85) para todas, así que
   * `HYGIENE_SCAN_STALE_MINUTES` valía 0.85 **minutos**: cualquier barrido de
   * más de 51 segundos daba colgado. Con ese stub, un test de "una corrida
   * recién arrancada no se toca" no puede escribirse — pasa a rojo aunque el
   * código esté bien, y el borde de matar una corrida viva queda sin cubrir.
   *
   * Un mock que simplifica de más no falla: pasa, y decide en silencio qué
   * preguntas puede hacerse el archivo.
   */
  const config = {
    get: jest.fn((clave: string) =>
      clave === 'HYGIENE_SCAN_STALE_MINUTES' ? 20 : THRESHOLD,
    ),
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
      expect.objectContaining({
        where: expect.objectContaining({ scanId: 'scan-ready' }),
      }),
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

/**
 * ⭐ Cuarta aparición del mismo defecto, por otra puerta (2026-08-27).
 *
 * `startScan` ya cerraba las corridas colgadas. Pero eso destrabó el 409, no la
 * PANTALLA: el panel deshabilita el botón mientras el estado sea `RUNNING`, así
 * que una corrida muerta dejaba la única salida detrás de la puerta que ella
 * misma trababa. Quien miraba la pantalla no podía apretar nada, y el poll —lo
 * único que seguía corriendo— no reparaba nada.
 *
 * Encontrado en vivo: un `docker compose restart` mató el worker a los 20
 * segundos de un barrido de ~85, y la pantalla quedó en "Analizando…" para
 * siempre.
 *
 * La lección es la de las tres veces anteriores con un agregado: no alcanza con
 * que exista la recuperación, tiene que estar en un camino que quien está
 * trabado pueda recorrer.
 */
describe('⭐ latestScan — la lectura también destraba un barrido colgado', () => {
  function zombiDe(minutosDeVida: number) {
    return {
      id: 'scan-zombi',
      status: 'RUNNING',
      threshold: 75,
      documentsScanned: 0,
      pairsFound: 0,
      failureReason: null,
      createdAt: new Date(Date.now() - minutosDeVida * 60_000),
      finishedAt: null,
    };
  }

  it('un RUNNING vencido pasa a FAILED sin que nadie apriete nada', async () => {
    const { service, prisma } = buildService([]);
    const hygieneScan = prisma.hygieneScan as {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    hygieneScan.findFirst
      .mockResolvedValueOnce(zombiDe(60)) // la última corrida: colgada
      .mockResolvedValueOnce(null); // no hubo ninguna READY antes
    hygieneScan.findUnique.mockResolvedValue({
      ...zombiDe(60),
      status: 'FAILED',
      failureReason: 'La corrida quedó sin terminar más de 20 minutos.',
    });

    const res = await service.latestScan('emp-1');

    // Lo que importa: el panel deja de ver RUNNING, así que el botón revive.
    expect(res.status).toBe('FAILED');
    expect(hygieneScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'scan-zombi' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('y el motivo dice qué pasó, en vez de desaparecer sin explicación', async () => {
    const { service, prisma } = buildService([]);
    const hygieneScan = prisma.hygieneScan as {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    hygieneScan.findFirst
      .mockResolvedValueOnce(zombiDe(60))
      .mockResolvedValueOnce(null);
    hygieneScan.findUnique.mockResolvedValue({
      ...zombiDe(60),
      status: 'FAILED',
      failureReason: 'La corrida quedó sin terminar más de 20 minutos.',
    });

    const res = await service.latestScan('emp-1');

    expect((res as { failureReason?: string }).failureReason).toMatch(
      /sin terminar más de \d+ minutos/,
    );
  });

  it('un RUNNING reciente NO se toca: sigue corriendo de verdad', async () => {
    // El borde que no se puede pasar por alto: matar una corrida viva por leer
    // la pantalla sería peor que el defecto que se está arreglando.
    const { service, prisma } = buildService([]);
    const hygieneScan = prisma.hygieneScan as {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    hygieneScan.findFirst
      .mockResolvedValueOnce(zombiDe(1)) // un minuto: recién arrancada
      .mockResolvedValueOnce(null);

    const res = await service.latestScan('emp-1');

    expect(res.status).toBe('RUNNING');
    expect(hygieneScan.update).not.toHaveBeenCalled();
  });

  it('mientras corre, dice CUÁNTOS documentos está mirando', async () => {
    // Lo devolvía solo `startScan`, así que al recargar la pantalla mostraba
    // «Analizando el corpus (~ documentos)», con el hueco a la vista.
    const { service, prisma } = buildService([]);
    (prisma.knowledgeDocument as { count: jest.Mock }).count.mockResolvedValue(
      74,
    );
    (prisma.hygieneScan as { findFirst: jest.Mock }).findFirst
      .mockResolvedValueOnce(zombiDe(1))
      .mockResolvedValueOnce(null);

    const res = await service.latestScan('emp-1');

    expect((res as { documentsToScan?: number }).documentsToScan).toBe(74);
  });

  it('en FAILED no se informa cuántos quedan: ya no queda nada corriendo', async () => {
    const { service, prisma } = buildService([]);
    (prisma.hygieneScan as { findFirst: jest.Mock }).findFirst
      .mockResolvedValueOnce({
        ...zombiDe(60),
        status: 'FAILED',
        failureReason: 'Gemini devolvió 429',
      })
      .mockResolvedValueOnce(null);

    const res = await service.latestScan('emp-1');

    expect(
      (res as { documentsToScan?: number }).documentsToScan,
    ).toBeUndefined();
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

describe('latestScan — una pareja resuelta deja de listarse (defecto encontrado en vivo)', () => {
  /**
   * El bug: `runScan` filtra por `isActive` y por descarte vigente, pero la
   * LECTURA no filtraba nada. Una pareja que ya se había fusionado —o que se
   * acababa de descartar— seguía en pantalla hasta correr el barrido de
   * nuevo, y correrlo no la sacaba si la corrida vieja seguía siendo la
   * última READY.
   *
   * Visto en vivo: se fusionó la pareja a las 02:55, el último barrido era de
   * las 02:53, y la pareja siguió apareciendo. "Ya lo solucioné y no se va."
   */
  const scanReady = {
    id: 'scan-1',
    status: 'READY',
    threshold: 85,
    documentsScanned: 75,
    pairsFound: 1,
    failureReason: null,
    createdAt: new Date(),
    finishedAt: new Date(),
  };

  function pareja(overrides: {
    aActivo?: boolean;
    bActivo?: boolean;
    versionA?: number;
    versionB?: number;
  }) {
    return {
      id: 'pair-1',
      scanId: 'scan-1',
      documentAId: 'doc-a',
      documentBId: 'doc-b',
      similarity: 85.7,
      escalatedTurns: 0,
      versionA: 1,
      versionB: 1,
      createdAt: new Date(),
      documentA: doc('doc-a', {
        title: 'Procedimiento de recepción',
        isActive: overrides.aActivo ?? true,
        version: overrides.versionA ?? 1,
      }),
      documentB: doc('doc-b', {
        title: 'Situación de capacitación',
        isActive: overrides.bActivo ?? true,
        version: overrides.versionB ?? 1,
      }),
    };
  }

  it('⚠️ FUSIONADA: si el documento absorbido quedó inactivo, la pareja NO se lista', async () => {
    const { service, prisma } = buildService([]);
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValue(scanReady);
    // El filtro vive en la consulta: con `isActive: true` en el where, Prisma
    // ya no la devuelve. Se representa devolviendo [] para ese filtro.
    (prisma.hygienePair.findMany as jest.Mock).mockResolvedValue([]);

    const res = await service.latestScan('emp-1');

    expect(res.pairs).toEqual([]);
    // Lo que fija el test es que el filtro se PIDA: sin esto, Prisma traía la
    // pareja igual y la pantalla la mostraba.
    expect(prisma.hygienePair.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentA: { isActive: true },
          documentB: { isActive: true },
        }),
      }),
    );
  });

  it('⚠️ DESCARTADA en las mismas versiones: la pareja NO se lista', async () => {
    const { service, prisma } = buildService([]);
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValue(scanReady);
    (prisma.hygienePair.findMany as jest.Mock).mockResolvedValue([
      pareja({ versionA: 1, versionB: 1 }),
    ]);
    (prisma.knowledgeMergeDiscard.findMany as jest.Mock).mockResolvedValue([
      { documentAId: 'doc-a', documentBId: 'doc-b', versionA: 1, versionB: 1 },
    ]);

    const res = await service.latestScan('emp-1');

    expect(res.pairs).toEqual([]);
  });

  it('pero un descarte de OTRA versión no la esconde — el documento cambió, vuelve a proponerse', async () => {
    const { service, prisma } = buildService([]);
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValue(scanReady);
    (prisma.hygienePair.findMany as jest.Mock).mockResolvedValue([
      pareja({ versionA: 2, versionB: 1 }),
    ]);
    // Se descartó cuando A estaba en v1; ahora está en v2.
    (prisma.knowledgeMergeDiscard.findMany as jest.Mock).mockResolvedValue([
      { documentAId: 'doc-a', documentBId: 'doc-b', versionA: 1, versionB: 1 },
    ]);

    const res = await service.latestScan('emp-1');

    expect(res.pairs).toHaveLength(1);
  });

  it('sin descartes, una pareja con los dos activos se lista normal', async () => {
    const { service, prisma } = buildService([]);
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValue(scanReady);
    (prisma.hygienePair.findMany as jest.Mock).mockResolvedValue([pareja({})]);

    const res = await service.latestScan('emp-1');

    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0].similarity).toBe(85.7);
  });

  it('sin parejas no consulta descartes — `OR: []` en Prisma no filtra nada', async () => {
    const { service, prisma } = buildService([]);
    (
      prisma.hygieneScan as { findFirst: jest.Mock }
    ).findFirst.mockResolvedValue(scanReady);
    (prisma.hygienePair.findMany as jest.Mock).mockResolvedValue([]);

    await service.latestScan('emp-1');

    expect(prisma.knowledgeMergeDiscard.findMany).not.toHaveBeenCalled();
  });
});
