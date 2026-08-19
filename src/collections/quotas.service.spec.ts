import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuotasService } from './quotas.service';
import { PrismaService } from '../database/prisma.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';

/**
 * Tests de QuotasService (Sprint 4 — Historia 5: marcar gestión manual).
 */
describe('QuotasService', () => {
  let service: QuotasService;
  let prisma: {
    quota: { findUnique: jest.Mock; update: jest.Mock };
    conversation: { findFirst: jest.Mock };
  };
  let logger: { logEvent: jest.Mock };
  let conversations: { addMessage: jest.Mock };
  let sender: { send: jest.Mock };

  beforeEach(() => {
    prisma = {
      quota: { findUnique: jest.fn(), update: jest.fn() },
      conversation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    logger = { logEvent: jest.fn() };
    conversations = { addMessage: jest.fn() };
    sender = { send: jest.fn() };

    service = new QuotasService(
      prisma as unknown as PrismaService,
      logger as unknown as OrchestrationLogger,
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
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

  // "Solicitar comprobante" (Fig 3): cliente avisó que pagó, sin comprobante.
  describe('requestProof', () => {
    const quota = {
      id: 'q1',
      clientId: 'c1',
      amount: 22800,
      client: {
        id: 'c1',
        name: 'Juan Pérez',
        phone: '5491100000000',
        assignedCollectorId: 'cobrador-1',
      },
    };

    it('envía el WhatsApp y registra el evento, aunque no haya conversación abierta', async () => {
      prisma.quota.findUnique.mockResolvedValue(quota);
      prisma.conversation.findFirst.mockResolvedValue(null);

      await service.requestProof('q1', 'cobrador-1', false);

      expect(sender.send).toHaveBeenCalledWith(
        '5491100000000',
        expect.stringContaining('comprobante'),
        'WHATSAPP',
      );
      expect(conversations.addMessage).not.toHaveBeenCalled();
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'proof_requested',
          payload: expect.objectContaining({ quotaId: 'q1' }),
        }),
      );
    });

    it('deja el mensaje en el historial si hay una conversación abierta', async () => {
      prisma.quota.findUnique.mockResolvedValue(quota);
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

      await service.requestProof('q1', 'cobrador-1', false);

      expect(conversations.addMessage).toHaveBeenCalledWith(
        'conv-1',
        'ASSISTANT',
        expect.stringContaining('comprobante'),
      );
    });

    it('rechaza si el cobrador no es el asignado y no es controlador', async () => {
      prisma.quota.findUnique.mockResolvedValue(quota);

      await expect(
        service.requestProof('q1', 'otro-cobrador', false),
      ).rejects.toThrow(ForbiddenException);
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('permite acceso a un controlador aunque no sea el cobrador asignado', async () => {
      prisma.quota.findUnique.mockResolvedValue(quota);
      prisma.conversation.findFirst.mockResolvedValue(null);

      await service.requestProof('q1', 'controlador-1', true);

      expect(sender.send).toHaveBeenCalled();
    });

    it('rechaza (404) si la cuota no existe', async () => {
      prisma.quota.findUnique.mockResolvedValue(null);

      await expect(
        service.requestProof('no-existe', 'cobrador-1', false),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
