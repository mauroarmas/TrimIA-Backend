/**
 * Tests del indicador de uso del conocimiento — Sprint 5A (US7, FR-047/FR-028).
 *
 * Lo que se protege acá es una distinción que se pierde muy fácil al
 * simplificar: **"nunca se usó" no es lo mismo que "anduvo mal"**. Devolver
 * `avgScore: 0` para un documento recién cargado invita a darlo de baja por
 * inútil cuando en realidad nadie preguntó nunca sobre el tema.
 */
import { KnowledgeUsageService } from './knowledge-usage.service';
import { PrismaService } from '../../database/prisma.service';

const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTRO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function buildService(rows: unknown[] = []) {
  const groupBy = jest.fn().mockResolvedValue(rows);
  const service = new KnowledgeUsageService({
    knowledgeRetrieval: { groupBy },
  } as unknown as PrismaService);
  return { service, groupBy };
}

describe('KnowledgeUsageService — sin datos ≠ score cero (FR-028)', () => {
  it('un documento sin recuperaciones da hasData:false y avgScore NULL', async () => {
    const { service } = buildService([]);

    const usage = await service.forDocument(DOC);

    expect(usage.hasData).toBe(false);
    // El punto entero del test: NO es 0.
    expect(usage.avgScore).toBeNull();
    expect(usage.retrievedCount).toBe(0);
  });

  it('un documento que se recuperó y salió mal SÍ tiene datos', async () => {
    // Contraste del anterior: acá hasData es true aunque nunca haya servido
    // para responder. Es la diferencia entre "no sabemos" y "sabemos que no
    // está funcionando" — la segunda sí justifica revisarlo.
    const { service } = buildService([
      {
        documentId: DOC,
        outcome: 'ESCALATED',
        _count: { _all: 4 },
        _sum: { score: 240 },
      },
    ]);

    const usage = await service.forDocument(DOC);

    expect(usage.hasData).toBe(true);
    expect(usage.retrievedCount).toBe(4);
    expect(usage.answeredCount).toBe(0);
    expect(usage.avgScore).toBe(60);
  });
});

describe('KnowledgeUsageService — cálculo', () => {
  it('suma los dos outcomes para el total y cuenta solo ANSWERED como usos útiles', async () => {
    const { service } = buildService([
      {
        documentId: DOC,
        outcome: 'ANSWERED',
        _count: { _all: 7 },
        _sum: { score: 560 },
      },
      {
        documentId: DOC,
        outcome: 'ESCALATED',
        _count: { _all: 3 },
        _sum: { score: 180 },
      },
    ]);

    const usage = await service.forDocument(DOC);

    expect(usage.retrievedCount).toBe(10);
    expect(usage.answeredCount).toBe(7);
  });

  it('promedia sobre el total de filas, no promediando promedios', async () => {
    // Los dos grupos tienen distinta cantidad de filas: (560+180)/10 = 74.
    // Promediar los promedios de cada grupo daría (80+60)/2 = 70, que no es
    // el promedio real de ninguna serie.
    const { service } = buildService([
      {
        documentId: DOC,
        outcome: 'ANSWERED',
        _count: { _all: 7 },
        _sum: { score: 560 },
      },
      {
        documentId: DOC,
        outcome: 'ESCALATED',
        _count: { _all: 3 },
        _sum: { score: 180 },
      },
    ]);

    const usage = await service.forDocument(DOC);

    expect(usage.avgScore).toBe(74);
  });
});

describe('KnowledgeUsageService.forDocuments — el listado no hace N+1', () => {
  it('resuelve una página entera con UNA sola query', async () => {
    // El listado del panel muestra hasta 100 documentos; una consulta por
    // fila sería el N+1 clásico en la pantalla que más se abre del módulo.
    const { service, groupBy } = buildService([
      {
        documentId: DOC,
        outcome: 'ANSWERED',
        _count: { _all: 2 },
        _sum: { score: 150 },
      },
    ]);

    await service.forDocuments([DOC, OTRO]);

    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  it('los documentos sin recuperaciones igual aparecen en el mapa', async () => {
    // Si faltaran, el panel tendría que distinguir `undefined` de "sin datos"
    // por su cuenta, y el default más cómodo (0) es justo el que engaña.
    const { service } = buildService([
      {
        documentId: DOC,
        outcome: 'ANSWERED',
        _count: { _all: 2 },
        _sum: { score: 150 },
      },
    ]);

    const usage = await service.forDocuments([DOC, OTRO]);

    expect(usage.get(OTRO)).toEqual({
      retrievedCount: 0,
      answeredCount: 0,
      avgScore: null,
      hasData: false,
    });
  });

  it('con la lista vacía no consulta nada', async () => {
    const { service, groupBy } = buildService();

    const usage = await service.forDocuments([]);

    expect(usage.size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
