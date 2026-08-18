import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../database/prisma.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { RealtimeService } from '../realtime/realtime.service';

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
  let realtime: { publish: jest.Mock };

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
    realtime = { publish: jest.fn() };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      sender as unknown as WhatsappSenderService,
      logger as unknown as OrchestrationLogger,
      realtime as unknown as RealtimeService,
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

  // Spec 004: addMessage y los cambios de estado son los DOS embudos por los que
  // sale todo lo que el panel recibe en tiempo real.
  describe('emisión de eventos en tiempo real (spec 004)', () => {
    const nuevoMensaje = (over: Record<string, unknown> = {}) => ({
      id: 'msg-1',
      conversationId: 'conv-1',
      role: 'ASSISTANT',
      content: 'hola',
      agentType: 'SALES',
      createdAt: new Date('2026-08-18T14:00:00.000Z'),
      ...over,
    });

    it('un mensaje ASSISTANT produce exactamente un evento', async () => {
      prisma.message.create.mockResolvedValue(nuevoMensaje());

      await service.addMessage('conv-1', 'ASSISTANT', 'hola', 'SALES');

      expect(realtime.publish).toHaveBeenCalledTimes(1);
      expect(realtime.publish).toHaveBeenCalledWith('conv-1', {
        type: 'message',
        conversationId: 'conv-1',
        data: {
          id: 'msg-1',
          role: 'ASSISTANT',
          content: 'hola',
          agentType: 'SALES',
          createdAt: '2026-08-18T14:00:00.000Z',
        },
      });
    });

    it('un mensaje USER también se emite: la otra pestaña tiene que verlo', async () => {
      prisma.message.create.mockResolvedValue(
        nuevoMensaje({ role: 'USER', agentType: null }),
      );

      await service.addMessage('conv-1', 'USER', 'hola');

      expect(realtime.publish).toHaveBeenCalledTimes(1);
    });

    // RF-015: el stream no puede mostrar lo que el historial no muestra.
    // listMessages() filtra a USER/ASSISTANT, así que emitir TOOL o SYSTEM sería
    // una fuga y encima inconsistente — al recargar desaparecerían.
    it.each(['TOOL', 'SYSTEM'] as const)(
      'un mensaje %s NO se emite',
      async (role) => {
        prisma.message.create.mockResolvedValue(nuevoMensaje({ role }));

        await service.addMessage('conv-1', role, 'interno');

        expect(realtime.publish).not.toHaveBeenCalled();
      },
    );

    it('setStatus emite el cambio de estado con el agente sticky', async () => {
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        status: 'WAITING_HUMAN',
        currentAgent: 'COLLECTIONS',
      });

      await service.setStatus('conv-1', 'WAITING_HUMAN');

      expect(realtime.publish).toHaveBeenCalledWith('conv-1', {
        type: 'status',
        conversationId: 'conv-1',
        data: { status: 'WAITING_HUMAN', currentAgent: 'COLLECTIONS' },
      });
    });

    // No lleva handledById: al dueño del chat le corresponde saber que una
    // persona lo atiende, no cuál (RF-015).
    it('el evento de estado no expone quién tiene el control', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        handledById: null,
      });
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        currentAgent: null,
        handledById: 'sup-1',
      });

      await service.takeover('conv-1', 'sup-1');

      const [, evento] = realtime.publish.mock.calls[0];
      expect(evento.data).toEqual({
        status: 'HUMAN_HANDLING',
        currentAgent: null,
      });
      expect(JSON.stringify(evento)).not.toContain('sup-1');
    });

    it('release emite el vuelta a ACTIVE', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'sup-1',
      });
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        currentAgent: 'SALES',
      });

      await service.release('conv-1', 'sup-1');

      expect(realtime.publish).toHaveBeenCalledWith('conv-1', {
        type: 'status',
        conversationId: 'conv-1',
        data: { status: 'ACTIVE', currentAgent: 'SALES' },
      });
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

    // ⭐ Spec 004, US2 — la falla de corrección más grave que arregla la spec.
    // replyManually() era el único de los siete caminos de persistencia que
    // escribía Prisma directo, salteándose el embudo, y por eso esta respuesta
    // nunca llegaba al chat abierto de la otra persona.
    it('emite el mensaje para que llegue al chat abierto del otro lado', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'sup-1',
        externalId: '5491100000000',
        channel: 'WEB',
        currentAgent: 'COLLECTIONS',
      });
      prisma.message.create.mockResolvedValue({
        id: 'msg-9',
        role: 'ASSISTANT',
        content: 'Te confirmo por acá: son 30 días de aviso.',
        agentType: 'COLLECTIONS',
        createdAt: new Date('2026-08-18T15:00:00.000Z'),
      });

      await service.replyManually(
        'conv-1',
        'sup-1',
        'Te confirmo por acá: son 30 días de aviso.',
      );

      expect(realtime.publish).toHaveBeenCalledWith('conv-1', {
        type: 'message',
        conversationId: 'conv-1',
        data: {
          id: 'msg-9',
          role: 'ASSISTANT',
          content: 'Te confirmo por acá: son 30 días de aviso.',
          agentType: 'COLLECTIONS',
          createdAt: '2026-08-18T15:00:00.000Z',
        },
      });
    });

    // El refactor pasó por addMessage(), que no valida nada: la autorización
    // tiene que seguir estando ANTES, y este test es el que lo sostiene.
    it('sigue exigiendo que la conversación esté en HUMAN_HANDLING', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        handledById: 'sup-1',
      });

      await expect(
        service.replyManually('conv-1', 'sup-1', 'hola'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(realtime.publish).not.toHaveBeenCalled();
    });

    // El orden importa: si se persistiera antes de enviar, un fallo del envío
    // dejaría en el historial un mensaje que el usuario nunca recibió.
    it('envía por el canal ANTES de persistir', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDLING',
        handledById: 'sup-1',
        externalId: '5491100000000',
        channel: 'WHATSAPP',
        currentAgent: null,
      });
      prisma.message.create.mockResolvedValue({
        id: 'msg-1',
        role: 'ASSISTANT',
        content: 'hola',
        agentType: null,
        createdAt: new Date(),
      });

      await service.replyManually('conv-1', 'sup-1', 'hola');

      expect(sender.send.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.message.create.mock.invocationCallOrder[0],
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

  // ⭐ US6 / RF-024 — el primer camino del proyecto que escribe CLOSED.
  describe('close — terminar la conversación (spec 004, US6)', () => {
    it('pasa la conversación a CLOSED y lo emite', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
      });
      prisma.conversation.update.mockResolvedValue({
        id: 'conv-1',
        status: 'CLOSED',
        currentAgent: 'SALES',
      });

      await service.close('conv-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { status: 'CLOSED' },
      });
      // Cerrar es un cambio de estado y viaja como cualquier otro: así la otra
      // pestaña se entera y su entrega se corta (CL-15).
      expect(realtime.publish).toHaveBeenCalledWith('conv-1', {
        type: 'status',
        conversationId: 'conv-1',
        data: { status: 'CLOSED', currentAgent: 'SALES' },
      });
    });

    // CL-14 — no es solo suya: hay una persona involucrada y una escalación abierta.
    it.each(['WAITING_HUMAN', 'HUMAN_HANDLING'])(
      'rechaza con 409 si la conversación está %s',
      async (status) => {
        prisma.conversation.findUnique.mockResolvedValue({
          id: 'conv-1',
          status,
        });

        await expect(service.close('conv-1')).rejects.toThrow(
          ConflictException,
        );
        expect(prisma.conversation.update).not.toHaveBeenCalled();
        expect(realtime.publish).not.toHaveBeenCalled();
      },
    );

    it('rechaza con 409 si ya estaba cerrada', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'CLOSED',
      });

      await expect(service.close('conv-1')).rejects.toThrow(ConflictException);
    });

    it('da 404 si la conversación no existe', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(service.close('conv-1')).rejects.toThrow(NotFoundException);
    });

    // Es LA consecuencia de cerrar, y la razón por la que solo puede ser explícito:
    // getOrCreate() filtra las cerradas, así que el próximo mensaje abre otro hilo
    // y con él se reinician el agente sticky y el historial que ve el LLM.
    it('después de cerrar, getOrCreate abre una conversación NUEVA', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'conv-2' });

      const nueva = await service.getOrCreate('5491100000000', 'WEB');

      // El filtro es el mecanismo: sin él, cerrar no tendría ningún efecto.
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: { not: 'CLOSED' } }),
      });
      expect(nueva).toEqual({ id: 'conv-2' });
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
    message: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      conversation: { findMany: jest.fn() },
      message: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    };

    service = new ConversationsService(
      prisma as unknown as PrismaService,
      { send: jest.fn() } as unknown as WhatsappSenderService,
      { logEvent: jest.fn() } as unknown as OrchestrationLogger,
      { publish: jest.fn() } as unknown as RealtimeService,
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

  // Spec 004, RF-006: la reanudación tras reconectar se resuelve en el backend y
  // no dejando que el panel filtre — el panel no tiene tests y esto es
  // verificable.
  describe('listMessages con `after` (reanudación)', () => {
    it('filtra por createdAt posterior al mensaje indicado', async () => {
      prisma.message.findUnique.mockResolvedValue({
        createdAt: new Date('2026-08-18T14:00:00.000Z'),
        conversationId: 'conv-1',
      });
      prisma.message.findMany.mockResolvedValue([
        { id: 'msg-2' },
        { id: 'msg-3' },
      ]);
      prisma.message.count.mockResolvedValue(2);

      const res = await service.listMessages('conv-1', { after: 'msg-1' });

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            conversationId: 'conv-1',
            createdAt: { gt: new Date('2026-08-18T14:00:00.000Z') },
          }),
        }),
      );
      expect(res.data).toHaveLength(2);
    });

    it('sin `after` no agrega ningún filtro por fecha', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      await service.listMessages('conv-1', {});

      const [[args]] = prisma.message.findMany.mock.calls;
      expect(args.where.createdAt).toBeUndefined();
      expect(prisma.message.findUnique).not.toHaveBeenCalled();
    });

    // Ignorar un cursor inválido en silencio le reenviaría la conversación
    // entera al cliente y parecería que funciona.
    it('falla explícito si el mensaje de `after` no existe', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(
        service.listMessages('conv-1', { after: 'no-existe' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    // Si no se validara la pertenencia, `after` serviría para tantear ids de
    // otras conversaciones por la diferencia entre 404 y 200.
    it('falla si el mensaje de `after` es de otra conversación', async () => {
      prisma.message.findUnique.mockResolvedValue({
        createdAt: new Date(),
        conversationId: 'otra-conv',
      });

      await expect(
        service.listMessages('conv-1', { after: 'msg-ajeno' }),
      ).rejects.toThrow(NotFoundException);
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
