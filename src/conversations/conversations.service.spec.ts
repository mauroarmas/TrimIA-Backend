import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../database/prisma.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';

/**
 * Tests de ConversationsService (Sprint 3 — control manual human-in-the-loop).
 */
describe('ConversationsService — takeover/release/replyManually', () => {
  let service: ConversationsService;
  let prisma: {
    conversation: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    message: { create: jest.Mock; findMany: jest.Mock };
    internalNote: { create: jest.Mock; findMany: jest.Mock };
  };
  let sender: { send: jest.Mock };
  let logger: { logEvent: jest.Mock };

  beforeEach(() => {
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      message: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      internalNote: { create: jest.fn(), findMany: jest.fn() },
    };
    sender = { send: jest.fn() };
    logger = { logEvent: jest.fn() };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      sender as unknown as WhatsappSenderService,
      logger as unknown as OrchestrationLogger,
    );
  });

  // FK Conversation → Client: el vínculo con el cliente deja de resolverse
  // cruzando `externalId == phone` en cada consulta.
  describe('getOrCreate — vínculo con Client', () => {
    it('crea la conversación con el clientId recibido', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'conv-1' });

      await service.getOrCreate('549123', 'WHATSAPP', 'client-1');

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: {
          externalId: '549123',
          channel: 'WHATSAPP',
          clientId: 'client-1',
        },
      });
    });

    it('retro-completa el clientId de una conversación abierta que no lo tenía', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        clientId: null,
      });
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        clientId: 'client-1',
      });

      const result = await service.getOrCreate(
        '549123',
        'WHATSAPP',
        'client-1',
      );

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { clientId: 'client-1' },
      });
      expect(result.clientId).toBe('client-1');
    });

    it('no reasigna el cliente si la conversación ya tiene uno', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        clientId: 'client-original',
      });

      const result = await service.getOrCreate(
        '549123',
        'WHATSAPP',
        'client-otro',
      );

      expect(prisma.conversation.update).not.toHaveBeenCalled();
      expect(result.clientId).toBe('client-original');
    });

    it('sin clientId (contacto desconocido) crea la conversación igual', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'conv-1' });

      await service.getOrCreate('549999', 'WHATSAPP', undefined);

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: {
          externalId: '549999',
          channel: 'WHATSAPP',
          clientId: undefined,
        },
      });
    });
  });

  /**
   * El mensaje del cliente se persiste ANTES de encolar el job, así que sin
   * excluirlo el agente lo recibía dos veces: en el historial y en la
   * consulta.
   */
  describe('getRecentHistory — mensaje actual', () => {
    it('excluye el mensaje que se está procesando', async () => {
      await service.getRecentHistory('conv-1', 6, 'msg-actual');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'msg-actual' } }),
        }),
      );
    });

    it('sin excludeMessageId no agrega ningún filtro por id', async () => {
      await service.getRecentHistory('conv-1');

      const { where } = prisma.message.findMany.mock.calls[0][0];
      expect(where).not.toHaveProperty('id');
    });

    it('devuelve los turnos del más antiguo al más reciente', async () => {
      prisma.message.findMany.mockResolvedValue([
        { role: 'ASSISTANT', content: 'nuevo' },
        { role: 'USER', content: 'viejo' },
      ]);

      const history = await service.getRecentHistory('conv-1');

      expect(history.map((t) => t.content)).toEqual(['viejo', 'nuevo']);
    });
  });

  // Las notas de agente y las humanas conviven en la misma tabla (aparecen
  // juntas en el timeline del panel), distinguidas por authorAgentType.
  describe('addAgentNote', () => {
    it('guarda la nota con authorAgentType y sin authorId', async () => {
      prisma.internalNote.create.mockResolvedValue({ id: 'note-1' });

      await service.addAgentNote('conv-1', 'SALES', 'Resumen del caso');

      expect(prisma.internalNote.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-1',
          authorAgentType: 'SALES',
          content: 'Resumen del caso',
        },
      });
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'internal_note_added' }),
      );
    });
  });

  describe('takeover', () => {
    it('toma el control de una conversación ACTIVE', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        handledById: null,
      });
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'emp-1',
      });

      const result = await service.takeover('conv-1', 'emp-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: expect.objectContaining({
            status: 'HUMAN_HANDLING',
            handledById: 'emp-1',
          }),
        }),
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'conversation_takeover' }),
      );
      expect(result.status).toBe('HUMAN_HANDLING');
    });

    it('rechaza tomar una conversación ya tomada por otro supervisor (409)', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'otro-supervisor',
      });

      await expect(service.takeover('conv-1', 'emp-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('rechaza tomar una conversación CLOSED (400)', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'CLOSED',
        handledById: null,
      });

      await expect(service.takeover('conv-1', 'emp-1')).rejects.toThrow();
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('rechaza tomar una conversación que no existe (404)', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(service.takeover('no-existe', 'emp-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('release', () => {
    it('libera el control de quien lo tiene tomado', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'emp-1',
      });
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        handledById: null,
      });

      const result = await service.release('conv-1', 'emp-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            handledById: null,
            handledAt: null,
          }),
        }),
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'conversation_release' }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('rechaza liberar si quien lo pide no es quien la tomó (403)', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'otro-supervisor',
      });

      await expect(service.release('conv-1', 'emp-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('rechaza liberar una conversación que no está en HUMAN_HANDLING (409)', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        handledById: null,
      });

      await expect(service.release('conv-1', 'emp-1')).rejects.toThrow(
        ConflictException,
      );
    });

    // Bug real: un EMPLEADO toma una conversación vía markManualHandling
    // ("voy a manejarlo yo", Sprint 4), que no exige SUPERVISOR. Sin este
    // bypass, esa conversación queda en HUMAN_HANDLING para siempre — el
    // endpoint de liberación es SUPERVISOR-only, y un supervisor distinto al
    // que la tomó era rechazado por no coincidir el handledById.
    it('con asSupervisor=true, libera aunque quien la tomó sea otra persona', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'empleado-que-la-tomo',
      });
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        handledById: null,
      });

      const result = await service.release('conv-1', 'supervisor-1', true);

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            handledById: null,
          }),
        }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('sin asSupervisor, sigue rechazando a quien no la tomó (default seguro)', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'empleado-que-la-tomo',
      });

      await expect(service.release('conv-1', 'otro-empleado')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  describe('replyManually', () => {
    it('envía el mensaje al usuario mientras dura el control manual', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'emp-1',
        externalId: '5491100000000',
        channel: 'WHATSAPP',
        currentAgent: 'SALES',
      });
      prisma.message.create.mockResolvedValue({ id: 'msg-1' });

      await service.replyManually(
        'conv-1',
        'emp-1',
        'Dale, te tomo el pedido yo.',
      );

      expect(sender.send).toHaveBeenCalledWith(
        '5491100000000',
        'Dale, te tomo el pedido yo.',
        'WHATSAPP',
      );
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-1',
            role: 'ASSISTANT',
            content: 'Dale, te tomo el pedido yo.',
          }),
        }),
      );
    });

    it('rechaza responder si quien lo pide no tiene el control (403)', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'otro-supervisor',
      });

      await expect(
        service.replyManually('conv-1', 'emp-1', 'hola'),
      ).rejects.toThrow(ForbiddenException);
      expect(sender.send).not.toHaveBeenCalled();
    });
  });

  describe('notas internas', () => {
    it('addInternalNote crea la nota asociada a la conversación y al autor', async () => {
      prisma.internalNote.create.mockResolvedValue({
        id: 'note-1',
        conversationId: 'conv-1',
        authorId: 'emp-1',
        content: 'Cliente pidió que lo llamen.',
      });

      const note = await service.addInternalNote(
        'conv-1',
        'emp-1',
        'Cliente pidió que lo llamen.',
      );

      expect(prisma.internalNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            conversationId: 'conv-1',
            authorId: 'emp-1',
            content: 'Cliente pidió que lo llamen.',
          },
        }),
      );
      expect(note.id).toBe('note-1');
      // Nunca debe crear un Message a partir de una nota interna.
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('listInternalNotes devuelve las notas de una conversación', async () => {
      prisma.internalNote.findMany.mockResolvedValue([
        { id: 'note-1', content: 'nota 1' },
      ]);

      const notes = await service.listInternalNotes('conv-1');

      expect(prisma.internalNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: 'conv-1' } }),
      );
      expect(notes).toHaveLength(1);
    });
  });
});

/**
 * Tests de la vista de chat web y de la línea de tiempo unificada —
 * Sprint 5A (US4, FR-015/FR-018).
 */
describe('ConversationsService — listMessages y getUnifiedTimeline', () => {
  let service: ConversationsService;
  let prisma: {
    conversation: { findMany: jest.Mock };
    message: { findMany: jest.Mock; count: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      conversation: { findMany: jest.fn() },
      message: { findMany: jest.fn(), count: jest.fn() },
    };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      { send: jest.fn() } as unknown as WhatsappSenderService,
      { logEvent: jest.fn() } as unknown as OrchestrationLogger,
    );
  });

  describe('listMessages', () => {
    it('solo trae USER/ASSISTANT, igual que getRecentHistory', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      await service.listMessages('conv-1');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId: 'conv-1',
            role: { in: ['USER', 'ASSISTANT'] },
          },
        }),
      );
    });

    it('hasMore es true cuando quedan más páginas', async () => {
      prisma.message.findMany.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({ id: `m${i}` })),
      );
      prisma.message.count.mockResolvedValue(120);

      const result = await service.listMessages('conv-1', {
        page: 1,
        limit: 50,
      });

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(120);
    });

    it('hasMore es false en la última página', async () => {
      prisma.message.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ id: `m${i}` })),
      );
      prisma.message.count.mockResolvedValue(120);

      const result = await service.listMessages('conv-1', {
        page: 3,
        limit: 50,
      });

      expect(result.hasMore).toBe(false);
    });
  });

  describe('getUnifiedTimeline', () => {
    it('devuelve null si el contacto no tiene ninguna conversación', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);

      const result = await service.getUnifiedTimeline('5493865505362');

      expect(result).toBeNull();
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('cada entrada del timeline lleva su channel y su conversationId', async () => {
      // Es lo que exige el caso borde de la spec sobre alguien escribiendo
      // por los dos canales a la vez: sin esta marca, dos hilos con agentes
      // distintos intercalados se leen como una sola conversación que nunca
      // existió.
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 'conv-wa',
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          currentAgent: 'SALES',
        },
        {
          id: 'conv-web',
          channel: 'WEB',
          status: 'ACTIVE',
          currentAgent: 'COLLECTIONS',
        },
      ]);
      prisma.message.findMany.mockResolvedValue([
        {
          conversationId: 'conv-wa',
          role: 'USER',
          content: 'a',
          agentType: null,
          createdAt: new Date(),
        },
        {
          conversationId: 'conv-web',
          role: 'USER',
          content: 'b',
          agentType: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.getUnifiedTimeline('5493865505362');

      expect(result!.timeline).toEqual([
        expect.objectContaining({
          conversationId: 'conv-wa',
          channel: 'WHATSAPP',
        }),
        expect.objectContaining({ conversationId: 'conv-web', channel: 'WEB' }),
      ]);
    });

    it('busca por externalId sin filtrar channel: una sola query correlaciona los dos hilos', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 'conv-wa',
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          currentAgent: null,
        },
      ]);
      prisma.message.findMany.mockResolvedValue([]);

      await service.getUnifiedTimeline('5493865505362');

      const where = prisma.conversation.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ externalId: '5493865505362' });
    });
  });
});
