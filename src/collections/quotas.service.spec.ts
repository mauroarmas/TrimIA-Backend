import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuotasService } from './quotas.service';
import { PrismaService } from '../database/prisma.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';

/**
 * Tests de QuotasService (Sprint 4 — Historia 5: marcar gestión manual).
 */
describe('QuotasService', () => {
  let service: QuotasService;
  let prisma: {
    quota: { findUnique: jest.Mock; update: jest.Mock };
  };
  let logger: { logEvent: jest.Mock };

  beforeEach(() => {
    prisma = {
      quota: { findUnique: jest.fn(), update: jest.fn() },
    };
    logger = { logEvent: jest.fn() };

    service = new QuotasService(
      prisma as unknown as PrismaService,
      logger as unknown as OrchestrationLogger,
    );
  });

  describe('markManual', () => {
    it('deja status=MANUAL y registra la nota si viene', async () => {
      const quota = {
        id: 'q1',
        status: 'PENDING',
        clientId: 'c1',
        client: { assignedCollectorId: 'cobrador-1' },
      };
      prisma.quota.findUnique.mockResolvedValue(quota);
      prisma.quota.update.mockResolvedValue({
        ...quota,
        status: 'MANUAL',
        manualHandlingNote: 'Cliente arregló por teléfono',
      });

      const result = await service.markManual(
        'q1',
        'cobrador-1',
        false,
        'Cliente arregló por teléfono',
      );

      expect(prisma.quota.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1' },
          data: expect.objectContaining({
            status: 'MANUAL',
            manualHandlingNote: 'Cliente arregló por teléfono',
          }),
        }),
      );
      expect(result.status).toBe('MANUAL');
    });

    it('rechaza (403) si el cobrador no tiene acceso (no isController)', async () => {
      const quota = {
        id: 'q1',
        client: { assignedCollectorId: 'otro-cobrador' },
      };
      prisma.quota.findUnique.mockResolvedValue(quota);

      await expect(
        service.markManual('q1', 'cobrador-1', false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('permite acceso si isController=true', async () => {
      const quota = {
        id: 'q1',
        status: 'PENDING',
        client: { assignedCollectorId: 'otro-cobrador' },
      };
      prisma.quota.findUnique.mockResolvedValue(quota);
      prisma.quota.update.mockResolvedValue({
        ...quota,
        status: 'MANUAL',
      });

      await service.markManual('q1', 'supervisor-1', true);

      expect(prisma.quota.update).toHaveBeenCalled();
    });

    it('rechaza (404) si la cuota no existe', async () => {
      prisma.quota.findUnique.mockResolvedValue(null);

      await expect(
        service.markManual('no-existe', 'cobrador-1', false),
      ).rejects.toThrow(NotFoundException);
    });

    it('audita el evento quota_marked_manual', async () => {
      const quota = {
        id: 'q1',
        status: 'PENDING',
        clientId: 'c1',
        client: { assignedCollectorId: 'cobrador-1' },
      };
      prisma.quota.findUnique.mockResolvedValue(quota);
      prisma.quota.update.mockResolvedValue({
        ...quota,
        status: 'MANUAL',
      });

      await service.markManual('q1', 'cobrador-1', false);

      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'quota_marked_manual',
          payload: expect.objectContaining({ quotaId: 'q1' }),
        }),
      );
    });
  });
});
