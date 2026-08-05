import { ConflictException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PaymentProofsService } from './payment-proofs.service';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ClientsService } from '../clients/clients.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { ImpactStatusDto } from './dto/verify-impact.dto';

/**
 * Tests de PaymentProofsService (Sprint 4 — Historia 1: confirmar comprobante).
 * Todas las dependencias se mockean: no tocamos DB/WhatsApp reales.
 */
describe('PaymentProofsService', () => {
  let service: PaymentProofsService;
  let prisma: {
    paymentProof: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
    };
    quota: { update: jest.Mock; findFirst: jest.Mock };
  };
  let conversations: {
    findById: jest.Mock;
    addMessage: jest.Mock;
    takeover: jest.Mock;
    addInternalNote: jest.Mock;
  };
  let clients: { getByPhone: jest.Mock };
  let sender: { send: jest.Mock };
  let logger: { logEvent: jest.Mock };
  let receiptQueue: { add: jest.Mock };
  let employees: { findById: jest.Mock };

  const message = { id: 'msg-1', conversationId: 'conv-1' };
  const conversation = {
    id: 'conv-1',
    externalId: '5491100000000',
    channel: 'WHATSAPP',
    currentAgent: 'COLLECTIONS',
  };
  const pendingProof = {
    id: 'proof-1',
    quotaId: 'inst-1',
    messageId: 'msg-1',
    message,
    status: 'PENDING_REVIEW',
    quota: {
      id: 'inst-1',
      client: { id: 'cust-1', assignedCollectorId: 'collector-1' },
    },
  };

  beforeEach(() => {
    prisma = {
      paymentProof: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      quota: { update: jest.fn(), findFirst: jest.fn() },
    };
    conversations = {
      findById: jest.fn().mockResolvedValue(conversation),
      addMessage: jest.fn(),
      takeover: jest.fn(),
      addInternalNote: jest.fn(),
    };
    clients = { getByPhone: jest.fn() };
    employees = { findById: jest.fn() };
    sender = { send: jest.fn() };
    logger = { logEvent: jest.fn() };
    receiptQueue = { add: jest.fn() };

    service = new PaymentProofsService(
      prisma as unknown as PrismaService,
      conversations as unknown as ConversationsService,
      clients as unknown as ClientsService,
      employees as unknown as any,
      sender as unknown as WhatsappSenderService,
      logger as unknown as OrchestrationLogger,
      receiptQueue as unknown as Queue,
    );
  });

  describe('accept', () => {
    it('acepta el comprobante, confirma al cliente y deja la cuota esperando verificación', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue(pendingProof);
      prisma.paymentProof.update.mockResolvedValue({
        ...pendingProof,
        status: 'ACCEPTED',
      });

      const result = await service.accept('proof-1', 'collector-1');

      expect(prisma.paymentProof.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proof-1' },
          data: expect.objectContaining({
            status: 'ACCEPTED',
            acceptedById: 'collector-1',
          }),
        }),
      );
      expect(prisma.quota.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inst-1' },
          data: expect.objectContaining({ status: 'AWAITING_CONFIRMATION' }),
        }),
      );
      expect(sender.send).toHaveBeenCalledWith(
        conversation.externalId,
        expect.any(String),
        conversation.channel,
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'payment_proof_accepted' }),
      );
      expect(result.status).toBe('ACCEPTED');
    });

    it('rechaza (409) un comprobante que ya fue resuelto', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue({
        ...pendingProof,
        status: 'ACCEPTED',
      });

      await expect(service.accept('proof-1', 'collector-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.paymentProof.update).not.toHaveBeenCalled();
    });

    it('rechaza (404) un comprobante inexistente', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue(null);

      await expect(service.accept('no-existe', 'collector-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('rechaza con el motivo PAST_DATE, avisa al cliente y vuelve la cuota a PENDING', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue(pendingProof);
      prisma.paymentProof.update.mockResolvedValue({
        ...pendingProof,
        status: 'REJECTED',
        rejectionReason: 'PAST_DATE',
      });

      const result = await service.reject('proof-1', 'collector-1', 'PAST_DATE');

      expect(prisma.paymentProof.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'PAST_DATE',
          }),
        }),
      );
      expect(prisma.quota.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inst-1' },
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      expect(sender.send).toHaveBeenCalledWith(
        conversation.externalId,
        expect.any(String),
        conversation.channel,
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'payment_proof_rejected' }),
      );
      expect(result.rejectionReason).toBe('PAST_DATE');
    });

    it('NO vuelve la cuota a PENDING si otro comprobante de la misma cuota ya está ACCEPTED', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue(pendingProof);
      prisma.paymentProof.update.mockResolvedValue({
        ...pendingProof,
        status: 'REJECTED',
      });
      // Otro PaymentProof de la misma Quota ya fue aceptado (ej. el
      // cliente mandó el comprobante dos veces y el cobrador ya resolvió uno).
      prisma.paymentProof.findFirst.mockResolvedValue({
        id: 'otro-proof',
        status: 'ACCEPTED',
      });

      await service.reject('proof-1', 'collector-1', 'WRONG_CBU');

      expect(prisma.quota.update).not.toHaveBeenCalled();
    });

    it.each(['PAST_DATE', 'WRONG_CBU', 'AMOUNT_TOO_LOW'] as const)(
      'compone un mensaje distinto para cada motivo (%s)',
      async (reason) => {
        prisma.paymentProof.findUnique.mockResolvedValue(pendingProof);
        prisma.paymentProof.update.mockResolvedValue({
          ...pendingProof,
          status: 'REJECTED',
        });
        sender.send.mockClear();

        await service.reject('proof-1', 'collector-1', reason);

        expect(sender.send).toHaveBeenCalledTimes(1);
        const [, textSent] = sender.send.mock.calls[0];
        expect(typeof textSent).toBe('string');
        expect(textSent.length).toBeGreaterThan(0);
      },
    );
  });

  describe('markManualHandling', () => {
    it('pausa la IA (takeover) y registra la nota, sin enviar mensaje al cliente', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue(pendingProof);
      prisma.paymentProof.update.mockResolvedValue({
        ...pendingProof,
        status: 'MANUAL_HANDLING',
      });

      await service.markManualHandling(
        'proof-1',
        'collector-1',
        'Cliente prefiere coordinar por teléfono.',
      );

      expect(conversations.takeover).toHaveBeenCalledWith('conv-1', 'collector-1');
      expect(conversations.addInternalNote).toHaveBeenCalledWith(
        'conv-1',
        'collector-1',
        'Cliente prefiere coordinar por teléfono.',
      );
      expect(sender.send).not.toHaveBeenCalled();
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'payment_proof_manual_handling' }),
      );
    });

    it('no registra nota si no se envía una', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue(pendingProof);
      prisma.paymentProof.update.mockResolvedValue({
        ...pendingProof,
        status: 'MANUAL_HANDLING',
      });

      await service.markManualHandling('proof-1', 'collector-1');

      expect(conversations.takeover).toHaveBeenCalledWith('conv-1', 'collector-1');
      expect(conversations.addInternalNote).not.toHaveBeenCalled();
    });
  });

  describe('receiveFromWhatsapp', () => {
    it('crea el comprobante contra la cuota vigente y encola la extracción', async () => {
      clients.getByPhone.mockResolvedValue({ id: 'cust-1' });
      prisma.quota.findFirst.mockResolvedValue({ id: 'inst-1' });
      prisma.paymentProof.create.mockResolvedValue({ id: 'proof-1' });

      const result = await service.receiveFromWhatsapp({
        phone: '5491100000000',
        messageId: 'msg-1',
        imagePath: 'uuid.jpg',
      });

      expect(prisma.paymentProof.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quotaId: 'inst-1',
            messageId: 'msg-1',
            imagePath: 'uuid.jpg',
          }),
        }),
      );
      expect(receiptQueue.add).toHaveBeenCalledWith(
        'extract-receipt',
        { paymentProofId: 'proof-1' },
        expect.any(Object),
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'payment_proof_received' }),
      );
      expect(result?.id).toBe('proof-1');
    });

    it('no crea nada si el teléfono no tiene un Client asociado', async () => {
      clients.getByPhone.mockResolvedValue(null);

      const result = await service.receiveFromWhatsapp({
        phone: '5491199999999',
        messageId: 'msg-2',
        imagePath: 'uuid2.jpg',
      });

      expect(prisma.paymentProof.create).not.toHaveBeenCalled();
      expect(receiptQueue.add).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('no crea nada si el cliente no tiene ninguna cuota vigente', async () => {
      clients.getByPhone.mockResolvedValue({ id: 'cust-1' });
      prisma.quota.findFirst.mockResolvedValue(null);

      const result = await service.receiveFromWhatsapp({
        phone: '5491100000000',
        messageId: 'msg-3',
        imagePath: 'uuid3.jpg',
      });

      expect(prisma.paymentProof.create).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('verifyImpact (Phase 5 — US3)', () => {
    const acceptedProof = {
      ...pendingProof,
      id: 'proof-accepted',
      status: 'ACCEPTED',
      acceptedById: 'collector-1',
      acceptedAt: new Date(),
      impactStatus: 'PENDING',
      quota: {
        id: 'inst-1',
        client: { id: 'cust-1', assignedCollectorId: 'collector-1' },
      },
    };

    it('rechaza (403) si el empleado no tiene isController = true', async () => {
      prisma.paymentProof.findUnique.mockResolvedValue(acceptedProof);
      employees.findById.mockResolvedValue({ id: 'collector-2', isController: false });

      await expect(
        service.verifyImpact('proof-accepted', 'collector-2', {
          impactStatus: ImpactStatusDto.CONFIRMED,
          observation: '',
        }),
      ).rejects.toThrow('Solo el Cobrador Controlador');
    });

    it('con impactStatus=CONFIRMED, envía confirmación al cliente y deja Quota.status=PAID', async () => {
      employees.findById.mockResolvedValue({ id: 'controller-1', isController: true });
      prisma.paymentProof.findUnique.mockResolvedValue(acceptedProof);
      prisma.paymentProof.update.mockResolvedValue({
        ...acceptedProof,
        impactStatus: ImpactStatusDto.CONFIRMED,
        impactVerifiedAt: new Date(),
      });

      const result = await service.verifyImpact('proof-accepted', 'controller-1', {
        impactStatus: ImpactStatusDto.CONFIRMED,
        observation: 'Confirmado en la cuenta',
      });

      expect(prisma.paymentProof.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proof-accepted' },
          data: expect.objectContaining({
            impactStatus: ImpactStatusDto.CONFIRMED,
            impactVerifiedById: 'controller-1',
            impactObservation: 'Confirmado en la cuenta',
          }),
        }),
      );
      expect(prisma.quota.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inst-1' },
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(sender.send).toHaveBeenCalledWith(
        conversation.externalId,
        expect.any(String),
        conversation.channel,
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'payment_impact_verified' }),
      );
    });

    it('con impactStatus=MISSING, notifica al cobrador responsable (sin cambiar estado de Quota)', async () => {
      const collector = { id: 'collector-1', phone: '5491100000001' };
      const proofWithCollector = {
        ...acceptedProof,
        quota: {
          ...acceptedProof.quota,
          client: { ...acceptedProof.quota.client, assignedCollector: collector },
        },
      };
      employees.findById.mockResolvedValue({ id: 'controller-1', isController: true });
      prisma.paymentProof.findUnique.mockResolvedValue(proofWithCollector);
      prisma.paymentProof.update.mockResolvedValue({
        ...proofWithCollector,
        impactStatus: ImpactStatusDto.MISSING,
      });

      const result = await service.verifyImpact('proof-accepted', 'controller-1', {
        impactStatus: ImpactStatusDto.MISSING,
        observation: 'No figura en la cuenta',
      });

      expect(prisma.paymentProof.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            impactStatus: ImpactStatusDto.MISSING,
            impactVerifiedById: 'controller-1',
          }),
        }),
      );
      // Cuota NO cambia de estado (sigue en AWAITING_CONFIRMATION)
      expect(prisma.quota.update).not.toHaveBeenCalled();
      // Notifica al cobrador responsable por WhatsApp
      expect(sender.send).toHaveBeenCalledWith(
        collector.phone,
        expect.any(String),
        expect.any(String), // channel
      );
    });

    it('rechaza (404) si el comprobante no existe', async () => {
      employees.findById.mockResolvedValue({ id: 'controller-1', isController: true });
      prisma.paymentProof.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyImpact('no-existe', 'controller-1', {
          impactStatus: ImpactStatusDto.CONFIRMED,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listAcceptedForImpactReview (Phase 5 — US3)', () => {
    it('devuelve solo comprobantes con status=ACCEPTED', async () => {
      const accepted = [
        { id: 'proof-1', status: 'ACCEPTED', impactStatus: 'PENDING' },
        { id: 'proof-2', status: 'ACCEPTED', impactStatus: 'PENDING' },
      ];
      prisma.paymentProof.findMany.mockResolvedValue(accepted);

      const result = await service.listAcceptedForImpactReview();

      expect(prisma.paymentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACCEPTED' },
        }),
      );
      expect(result).toEqual(accepted);
    });

    it('excluye comprobantes en PENDING_REVIEW, REJECTED y MANUAL_HANDLING', async () => {
      prisma.paymentProof.findMany.mockResolvedValue([]);

      await service.listAcceptedForImpactReview();

      const callArgs = prisma.paymentProof.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toBe('ACCEPTED');
      // Verifica que el where no incluya otros estados
      expect(callArgs.where).not.toHaveProperty(
        'status',
        expect.objectContaining({ in: expect.any(Array) }),
      );
    });

    it('ordena por fecha de aceptación descendente (más recientes primero)', async () => {
      prisma.paymentProof.findMany.mockResolvedValue([]);

      await service.listAcceptedForImpactReview();

      const callArgs = prisma.paymentProof.findMany.mock.calls[0][0];
      expect(callArgs.orderBy).toBeDefined();
      // Verifica que haya un orderBy con acceptedAt
      expect(callArgs.orderBy).toEqual(
        expect.objectContaining({ acceptedAt: 'desc' }),
      );
    });
  });
});
