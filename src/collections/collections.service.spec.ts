import { ForbiddenException } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Tests de CollectionsService (Sprint 4 — Historia 4: panel del cobrador).
 * Mockear Prisma para no tocar DB reales.
 */
describe('CollectionsService', () => {
  let service: CollectionsService;
  let prisma: {
    client: { findMany: jest.Mock; findUnique: jest.Mock };
    quota: { findMany: jest.Mock; count: jest.Mock };
    paymentProof: { findMany: jest.Mock; count: jest.Mock };
    message: { findMany: jest.Mock };
    internalNote: { findMany: jest.Mock };
    orchestrationEvent: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      client: { findMany: jest.fn(), findUnique: jest.fn() },
      quota: { findMany: jest.fn(), count: jest.fn() },
      paymentProof: { findMany: jest.fn(), count: jest.fn() },
      message: { findMany: jest.fn() },
      internalNote: { findMany: jest.fn() },
      orchestrationEvent: { findMany: jest.fn() },
    };

    service = new CollectionsService(prisma as unknown as PrismaService);
  });

  describe('getKpis', () => {
    it('cuenta cuotas pendientes solo del cobrador logueado (no isController)', async () => {
      prisma.quota.count.mockResolvedValue(2);
      prisma.paymentProof.count.mockResolvedValue(1);

      const result = await service.getKpis('cobrador-1', false);

      expect(prisma.quota.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            client: { assignedCollectorId: 'cobrador-1' },
          }),
        }),
      );
      expect(result.clientsWithPendingQuotas).toEqual(2);
      expect(result.proofsToReview).toEqual(1);
      expect(result.confirmedThisWeek).toBeDefined();
    });

    it('con isController=true, cuenta sin filtrar por cobrador', async () => {
      prisma.quota.count.mockResolvedValue(5);
      prisma.paymentProof.count.mockResolvedValue(3);

      await service.getKpis('supervisor-1', true);

      const calls = prisma.quota.count.mock.calls[0];
      expect(calls[0].where.client).toEqual({});
    });
  });

  describe('getClientHistory', () => {
    it('rechaza (403) si el cliente no es del cobrador y no es isController', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        assignedCollectorId: 'cobrador-2',
      });

      await expect(
        service.getClientHistory('c1', 'cobrador-1', false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('permite acceso si el cliente es del cobrador', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        assignedCollectorId: 'cobrador-1',
      });
      prisma.message.findMany.mockResolvedValue([
        { id: 'm1', createdAt: new Date(), type: 'message' },
      ]);
      prisma.internalNote.findMany.mockResolvedValue([]);
      prisma.orchestrationEvent.findMany.mockResolvedValue([]);

      const result = await service.getClientHistory('c1', 'cobrador-1', false);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('devuelve timeline unificada de Message + InternalNote + OrchestrationEvent ordenados por createdAt', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        assignedCollectorId: 'cobrador-1',
      });
      const now = new Date();
      const earlier = new Date(now.getTime() - 3600000);
      prisma.message.findMany.mockResolvedValue([
        { id: 'm1', createdAt: now, type: 'message', text: 'Hola' },
      ]);
      prisma.internalNote.findMany.mockResolvedValue([
        { id: 'n1', createdAt: earlier, type: 'internal_note' },
      ]);
      prisma.orchestrationEvent.findMany.mockResolvedValue([]);

      const result = await service.getClientHistory('c1', 'cobrador-1', false);

      expect(result.length).toBe(2);
      expect(result[0].createdAt).toEqual(earlier);
      expect(result[1].createdAt).toEqual(now);
    });
  });
});
