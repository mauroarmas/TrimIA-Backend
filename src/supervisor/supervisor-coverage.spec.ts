import { ConfigService } from '@nestjs/config';
import { SupervisorService } from './supervisor.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Tests de `getAgentsStatus` específicos de la spec 009 (US2), aparte de
 * `supervisor.service.spec.ts` para no seguir engordando ese archivo. Los
 * casos generales de combinar conversaciones + eventos ya están ahí; acá van
 * los que hacen a la métrica en sí — margen negativo y la distinción entre
 * "sin tráfico" y "recibió pero no alcanzó el mínimo".
 */
describe('SupervisorService — getAgentsStatus, cobertura y margen (spec 009)', () => {
  let service: SupervisorService;
  let prisma: {
    conversation: { groupBy: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      conversation: { groupBy: jest.fn() },
      $queryRaw: jest.fn(),
    };
    const configValues: Record<string, number> = {
      RAG_CONFIDENCE_THRESHOLD: 0.65,
      COVERAGE_MIN_SAMPLE: 10,
      COVERAGE_WINDOW_DAYS: 30,
    };
    config = { get: jest.fn((key: string) => configValues[key]) };
    service = new SupervisorService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
    prisma.conversation.groupBy
      .mockResolvedValueOnce([]) // totalByAgent
      .mockResolvedValueOnce([]); // activeByAgent
  });

  it('marginPoints es negativo cuando el promedio no llega al umbral — el caso real que abrió la spec', async () => {
    // El escenario medido en research.md D0: SALES con 0.674 de confianza
    // promedio y umbral en 0.65. Con muestra suficiente para publicarse.
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        agentType: 'SALES',
        avgConfidence: 0.62,
        escalations: 3n,
        covered: 5n,
        routed: 15n,
      },
    ]);

    const result = await service.getAgentsStatus();
    const sales = result.agents.find((a) => a.agentType === 'SALES')!;

    expect(sales.hasData).toBe(true);
    expect(sales.marginPoints).toBeLessThan(0);
    expect(sales.marginPoints).toBeCloseTo(-3); // (62 - 65)
    expect(sales.coverage).toBeCloseTo(5 / 15);
  });

  it('un agente que recibió turnos pero no alcanza el mínimo NO comparte el mismo estado que uno sin ningún turno', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        agentType: 'LOGISTICS',
        avgConfidence: 0.7,
        escalations: 0n,
        covered: 4n,
        routed: 4n, // < COVERAGE_MIN_SAMPLE (10)
      },
    ]);

    const result = await service.getAgentsStatus();
    const logistics = result.agents.find((a) => a.agentType === 'LOGISTICS')!;
    const collections = result.agents.find(
      (a) => a.agentType === 'COLLECTIONS',
    )!; // no viene en $queryRaw: nunca se le ruteó nada

    // Los dos tienen hasData: false y coverage/marginPoints: null...
    expect(logistics.hasData).toBe(false);
    expect(collections.hasData).toBe(false);
    expect(logistics.coverage).toBeNull();
    expect(collections.coverage).toBeNull();

    // ...pero routedTurns/sampleSize NO colapsan al mismo cero: ahí está la
    // distinción real entre "sin tráfico" y "recibió y no alcanzó el mínimo".
    expect(logistics.routedTurns).toBe(4);
    expect(logistics.sampleSize).toBe(4);
    expect(collections.routedTurns).toBe(0);
    expect(collections.sampleSize).toBe(0);
  });

  it('minimumSample y la ventana viajan en la respuesta aunque no haya datos', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await service.getAgentsStatus();
    const deposits = result.agents.find((a) => a.agentType === 'DEPOSITS')!;

    expect(deposits.minimumSample).toBe(10);
    expect(deposits.windowFrom).toBeInstanceOf(Date);
    expect(deposits.windowTo).toBeInstanceOf(Date);
    expect(deposits.windowFrom.getTime()).toBeLessThan(
      deposits.windowTo.getTime(),
    );
  });
});
