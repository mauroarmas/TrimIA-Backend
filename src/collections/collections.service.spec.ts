import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { PrismaService } from '../database/prisma.service';
import { EscalationsService } from '../escalations/escalations.service';

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
    conversation: { findFirst: jest.Mock };
  };
  let escalations: { create: jest.Mock };

  beforeEach(() => {
    prisma = {
      client: { findMany: jest.fn(), findUnique: jest.fn() },
      quota: { findMany: jest.fn(), count: jest.fn() },
      paymentProof: { findMany: jest.fn(), count: jest.fn() },
      message: { findMany: jest.fn() },
      internalNote: { findMany: jest.fn() },
      orchestrationEvent: { findMany: jest.fn() },
      conversation: { findFirst: jest.fn() },
    };
    escalations = { create: jest.fn() };

    service = new CollectionsService(
      prisma as unknown as PrismaService,
      escalations as unknown as EscalationsService,
    );
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

    it('filtra por la FK Conversation.clientId, no por el teléfono del cliente', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        phone: '5491100000000',
        assignedCollectorId: 'cobrador-1',
      });
      prisma.message.findMany.mockResolvedValue([]);
      prisma.internalNote.findMany.mockResolvedValue([]);
      prisma.orchestrationEvent.findMany.mockResolvedValue([]);

      await service.getClientHistory('c1', 'cobrador-1', false);

      const expected = { conversation: { clientId: 'c1' } };
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
      expect(prisma.internalNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
      expect(prisma.orchestrationEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
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

  // "Escalar el caso al supervisor" (Fig 3), disparado a mano por el cobrador.
  describe('escalateClient', () => {
    it('rechaza (403) si el cliente no es del cobrador y no es isController', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        assignedCollectorId: 'cobrador-2',
      });

      await expect(
        service.escalateClient('c1', 'cobrador-1', false, 'sin respuesta'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza (404) si el cliente no tiene una conversación abierta', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        assignedCollectorId: 'cobrador-1',
      });
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.escalateClient('c1', 'cobrador-1', false, 'sin respuesta'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza (409) si la conversación ya está en manejo manual', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        assignedCollectorId: 'cobrador-1',
      });
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
      });

      await expect(
        service.escalateClient('c1', 'cobrador-1', false, 'sin respuesta'),
      ).rejects.toThrow(ConflictException);
      expect(escalations.create).not.toHaveBeenCalled();
    });

    it('crea la escalation con el motivo del cobrador', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'c1',
        assignedCollectorId: 'cobrador-1',
      });
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
      });
      escalations.create.mockResolvedValue({ id: 'esc-1' });

      const result = await service.escalateClient(
        'c1',
        'cobrador-1',
        false,
        'No respondió a 3 recordatorios',
      );

      expect(escalations.create).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        reason: 'No respondió a 3 recordatorios',
      });
      expect(result).toEqual({ id: 'esc-1' });
    });
  });

  // "Registro de Actividad" cruzado (Fig 7): a diferencia de getClientHistory,
  // no fija un clientId único.
  describe('listActivity', () => {
    beforeEach(() => {
      prisma.message.findMany.mockResolvedValue([]);
      prisma.internalNote.findMany.mockResolvedValue([]);
      prisma.orchestrationEvent.findMany.mockResolvedValue([]);
    });

    it('un cobrador común solo ve sus propios clientes, ignore el collectorId pedido', async () => {
      prisma.client.findMany.mockResolvedValue([{ id: 'c1' }]);

      await service.listActivity('cobrador-1', false, { collectorId: 'otro' });

      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignedCollectorId: 'cobrador-1' },
        }),
      );
    });

    it('un controlador puede filtrar por un cobrador puntual', async () => {
      prisma.client.findMany.mockResolvedValue([{ id: 'c1' }]);

      await service.listActivity('controlador-1', true, { collectorId: 'cobrador-2' });

      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignedCollectorId: 'cobrador-2' },
        }),
      );
    });

    it('sin clientes en el alcance, devuelve vacío sin consultar las otras tablas', async () => {
      prisma.client.findMany.mockResolvedValue([]);

      const result = await service.listActivity('cobrador-1', false);

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20, hasMore: false });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('con eventType, solo consulta OrchestrationEvent (mensajes y notas quedan afuera)', async () => {
      prisma.client.findMany.mockResolvedValue([{ id: 'c1' }]);

      await service.listActivity('cobrador-1', false, {
        eventType: 'quota_reminder_sent',
      });

      expect(prisma.message.findMany).not.toHaveBeenCalled();
      expect(prisma.internalNote.findMany).not.toHaveBeenCalled();
      expect(prisma.orchestrationEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventType: 'quota_reminder_sent' }),
        }),
      );
    });

    it('combina y pagina mensajes, notas y eventos ordenados por fecha descendente', async () => {
      prisma.client.findMany.mockResolvedValue([{ id: 'c1' }]);
      const now = new Date();
      const earlier = new Date(now.getTime() - 3600000);
      prisma.message.findMany.mockResolvedValue([
        {
          id: 'm1',
          createdAt: now,
          role: 'USER',
          content: 'hola',
          agentType: null,
          conversation: { clientId: 'c1', client: { name: 'Juan Pérez' } },
        },
      ]);
      prisma.internalNote.findMany.mockResolvedValue([
        {
          id: 'n1',
          createdAt: earlier,
          authorId: 'cobrador-1',
          authorAgentType: null,
          content: 'nota',
          conversation: { clientId: 'c1', client: { name: 'Juan Pérez' } },
        },
      ]);

      const result = await service.listActivity('cobrador-1', false);

      expect(result.total).toBe(2);
      expect(result.data[0].id).toBe('m1');
      expect(result.data[0].clientName).toBe('Juan Pérez');
      expect(result.data[1].id).toBe('n1');
    });
  });
});
