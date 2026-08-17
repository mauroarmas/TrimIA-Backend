import { ConfigService } from '@nestjs/config';
import { SupervisorService } from './supervisor.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Tests del SupervisorService (Panel de Gobernanza — E4, Sprint 2).
 * Prisma se mockea: no tocamos la base real, verificamos la lógica de agregación
 * y de paginación que arma cada respuesta del panel.
 */
describe('SupervisorService', () => {
  let service: SupervisorService;
  let prisma: {
    conversation: { groupBy: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    orchestrationEvent: { findMany: jest.Mock; count: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      conversation: {
        groupBy: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      orchestrationEvent: { findMany: jest.fn(), count: jest.fn() },
      $queryRaw: jest.fn(),
    };
    config = { get: jest.fn().mockReturnValue(0.65) };

    service = new SupervisorService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  describe('getAgentsStatus', () => {
    it('devuelve los 5 agentes, combinando conversaciones y confianza del RAG', async () => {
      const lastActivity = new Date('2026-08-01T10:00:00Z');

      // totalByAgent: SALES tiene 3 conversaciones; ADMIN 1.
      prisma.conversation.groupBy
        .mockResolvedValueOnce([
          {
            currentAgent: 'SALES',
            _count: { _all: 3 },
            _max: { updatedAt: lastActivity },
          },
          {
            currentAgent: 'ADMIN',
            _count: { _all: 1 },
            _max: { updatedAt: lastActivity },
          },
        ])
        // activeByAgent: solo SALES tiene 2 activas.
        .mockResolvedValueOnce([
          { currentAgent: 'SALES', _count: { _all: 2 } },
        ]);

      // eventStats (raw): SALES con confianza y un escalado; ADMIN sin escalados.
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          agentType: 'SALES',
          avgConfidence: 0.7777,
          escalations: 1n,
          routed: 4n,
        },
        { agentType: 'ADMIN', avgConfidence: 0.9, escalations: 0n, routed: 2n },
      ]);

      const result = await service.getAgentsStatus();

      expect(result.confidenceThreshold).toBe(0.65);
      expect(result.agents).toHaveLength(5);

      const sales = result.agents.find((a) => a.agentType === 'SALES')!;
      expect(sales.status).toBe('active');
      expect(sales.totalConversations).toBe(3);
      expect(sales.activeConversations).toBe(2);
      expect(sales.lastActivityAt).toEqual(lastActivity);
      expect(sales.routedTurns).toBe(4);
      expect(sales.avgConfidence).toBe(0.778); // redondeado a 3 decimales
      expect(sales.escalations).toBe(1);
      expect(sales.escalationRate).toBeCloseTo(0.25);

      const admin = result.agents.find((a) => a.agentType === 'ADMIN')!;
      // Tiene conversaciones pero ninguna ACTIVE → idle.
      expect(admin.status).toBe('idle');
      expect(admin.activeConversations).toBe(0);
      expect(admin.escalationRate).toBe(0);
    });

    it('un agente sin datos aparece idle, en cero y con avgConfidence null', async () => {
      prisma.conversation.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.getAgentsStatus();

      const deposits = result.agents.find((a) => a.agentType === 'DEPOSITS')!;
      expect(deposits.status).toBe('idle');
      expect(deposits.totalConversations).toBe(0);
      expect(deposits.avgConfidence).toBeNull();
      expect(deposits.routedTurns).toBe(0);
      expect(deposits.escalationRate).toBe(0);
      expect(deposits.lastActivityAt).toBeNull();
    });
  });

  describe('getConversations', () => {
    it('acota page y limit a rangos válidos y calcula hasMore', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);
      prisma.conversation.count.mockResolvedValue(50);

      const res = await service.getConversations({ page: 0, limit: 999 });

      // page < 1 se sube a 1; limit > 100 se recorta a 100.
      expect(res.page).toBe(1);
      expect(res.limit).toBe(100);
      expect(res.total).toBe(50);
      expect(res.hasMore).toBe(true); // skip(0) + 2 devueltos < 50 total
    });

    it('aplica los filtros recibidos al where de Prisma', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.conversation.count.mockResolvedValue(0);

      await service.getConversations({
        status: 'WAITING_HUMAN',
        agentType: 'SALES',
      });

      const arg = prisma.conversation.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        status: 'WAITING_HUMAN',
        currentAgent: 'SALES',
      });
    });
  });
});
