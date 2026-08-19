import { ConflictException, NotFoundException } from '@nestjs/common';
import { EscalationsService } from './escalations.service';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { EmployeesService } from '../employees/employees.service';

/**
 * Tests de EscalationsService (Sprint 3 — Human-in-the-loop).
 * Todas las dependencias se mockean: no tocamos DB/WhatsApp/RAG reales.
 */
describe('EscalationsService', () => {
  let service: EscalationsService;
  let prisma: {
    escalation: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let conversations: {
    findById: jest.Mock;
    addMessage: jest.Mock;
    setStatus: jest.Mock;
    addAgentNote: jest.Mock;
    getLastUserMessage: jest.Mock;
  };
  let sender: { send: jest.Mock };
  let logger: { logEvent: jest.Mock };
  let knowledge: { ingest: jest.Mock };
  let employees: { findById: jest.Mock };

  const conversation = {
    id: 'conv-1',
    externalId: '5491100000000',
    channel: 'WHATSAPP',
    userType: 'CLIENTE',
    currentAgent: 'SALES',
    status: 'WAITING_HUMAN',
  };

  beforeEach(() => {
    prisma = {
      escalation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    conversations = {
      findById: jest.fn().mockResolvedValue(conversation),
      addMessage: jest.fn(),
      setStatus: jest.fn(),
      addAgentNote: jest.fn(),
      getLastUserMessage: jest.fn(),
    };
    sender = { send: jest.fn() };
    logger = { logEvent: jest.fn() };
    knowledge = { ingest: jest.fn() };
    employees = { findById: jest.fn() };

    service = new EscalationsService(
      prisma as unknown as PrismaService,
      conversations as unknown as ConversationsService,
      sender as unknown as WhatsappSenderService,
      logger as unknown as OrchestrationLogger,
      knowledge as unknown as KnowledgeService,
      employees as unknown as EmployeesService,
    );
  });

  describe('create', () => {
    it('crea una Escalation PENDING y deja la conversación en WAITING_HUMAN', async () => {
      prisma.escalation.findFirst.mockResolvedValue(null); // sin PENDING previa
      prisma.escalation.create.mockResolvedValue({
        id: 'esc-1',
        conversationId: 'conv-1',
        reason: 'confianza insuficiente (0.42)',
        status: 'PENDING',
      });

      const result = await service.create({
        conversationId: 'conv-1',
        reason: 'confianza insuficiente (0.42)',
      });

      expect(result.id).toBe('esc-1');
      expect(prisma.escalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-1',
            reason: 'confianza insuficiente (0.42)',
          }),
        }),
      );
      expect(conversations.setStatus).toHaveBeenCalledWith(
        'conv-1',
        'WAITING_HUMAN',
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          eventType: 'escalation_created',
        }),
      );
    });

    it('no crea una segunda Escalation si ya hay una PENDING para la misma conversación', async () => {
      const existing = {
        id: 'esc-existing',
        conversationId: 'conv-1',
        status: 'PENDING',
      };
      prisma.escalation.findFirst.mockResolvedValue(existing);

      const result = await service.create({
        conversationId: 'conv-1',
        reason: 'otra consulta sin resolver',
      });

      expect(result.id).toBe('esc-existing');
      expect(prisma.escalation.create).not.toHaveBeenCalled();
      expect(conversations.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    const pending = {
      id: 'esc-1',
      conversationId: 'conv-1',
      status: 'PENDING',
    };

    it('responde al usuario, marca RESOLVED y vuelve la conversación a ACTIVE', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      const result = await service.resolve(
        'esc-1',
        { message: 'Sí, la tenemos en 12 cuotas.' },
        'employee-1',
      );

      expect(sender.send).toHaveBeenCalledWith(
        conversation.externalId,
        'Sí, la tenemos en 12 cuotas.',
        conversation.channel,
      );
      expect(conversations.addMessage).toHaveBeenCalledWith(
        'conv-1',
        'ASSISTANT',
        'Sí, la tenemos en 12 cuotas.',
        conversation.currentAgent,
      );
      expect(conversations.setStatus).toHaveBeenCalledWith('conv-1', 'ACTIVE');
      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'esc-1' },
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedById: 'employee-1',
            resolution: 'Sí, la tenemos en 12 cuotas.',
          }),
        }),
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'escalation_resolved' }),
      );
      expect(result.status).toBe('RESOLVED');
      // Esta fase (US1) todavía no enseña al RAG.
      expect(knowledge.ingest).not.toHaveBeenCalled();
    });

    it('rechaza resolver una Escalation que no existe', async () => {
      prisma.escalation.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve('no-existe', { message: 'hola' }, 'employee-1'),
      ).rejects.toThrow(NotFoundException);
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('rechaza resolver una Escalation que ya estaba RESOLVED (409)', async () => {
      prisma.escalation.findUnique.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await expect(
        service.resolve('esc-1', { message: 'hola' }, 'employee-1'),
      ).rejects.toThrow(ConflictException);
      expect(sender.send).not.toHaveBeenCalled();
      expect(prisma.escalation.update).not.toHaveBeenCalled();
    });

    /**
     * Fix de seguridad (2026-08-11): antes, con teachAgent: true, la
     * audiencia se INFERÍA del userType de la conversación (CLIENTE →
     * PUBLICO automático). Un supervisor podía tipear un matiz interno para
     * un caso puntual y terminar publicándolo, sin haberlo decidido, como
     * respuesta servida a cualquier cliente futuro. Ahora el default es
     * INTERNO pase lo que pase con la conversación — publicar requiere
     * audience: PUBLICO explícito.
     */
    it('con teachAgent: true y sin audience explícita, ingesta como INTERNO aunque la conversación sea con un CLIENTE', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await service.resolve(
        'esc-1',
        { message: 'Sí, la tenemos en 12 cuotas.', teachAgent: true },
        'employee-1',
      );

      // conversation.userType = 'CLIENTE', pero el default ya no se infiere.
      expect(knowledge.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Sí, la tenemos en 12 cuotas.',
          audience: 'INTERNO',
          agentType: conversation.currentAgent,
        }),
      );
    });

    it('con teachAgent: true y audience: PUBLICO explícita, respeta lo que pidió el supervisor', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await service.resolve(
        'esc-1',
        {
          message: 'Sí, la tenemos en 12 cuotas.',
          teachAgent: true,
          audience: 'PUBLICO',
        },
        'employee-1',
      );

      expect(knowledge.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ audience: 'PUBLICO' }),
      );
    });

    it('sin teachAgent, no ingesta nada al RAG', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await service.resolve('esc-1', { message: 'hola' }, 'employee-1');

      expect(knowledge.ingest).not.toHaveBeenCalled();
    });
  });

  describe('delegate', () => {
    const pending = {
      id: 'esc-1',
      conversationId: 'conv-1',
      status: 'PENDING',
    };

    it('reasigna el caso a otro supervisor activo', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      employees.findById.mockResolvedValue({
        id: 'emp-2',
        role: 'SUPERVISOR',
        isActive: true,
      });
      prisma.escalation.update.mockResolvedValue({
        ...pending,
        delegatedToId: 'emp-2',
      });

      const result = await service.delegate(
        'esc-1',
        { toEmployeeId: 'emp-2' },
        'emp-1',
      );

      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'esc-1' },
          data: expect.objectContaining({
            delegatedToId: 'emp-2',
            delegatedById: 'emp-1',
          }),
        }),
      );
      expect(logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'escalation_delegated' }),
      );
      expect(result.delegatedToId).toBe('emp-2');
    });

    it('rechaza delegar a un empleado que no es SUPERVISOR', async () => {
      prisma.escalation.findUnique.mockResolvedValue(pending);
      employees.findById.mockResolvedValue({
        id: 'emp-2',
        role: 'EMPLEADO',
        isActive: true,
      });

      await expect(
        service.delegate('esc-1', { toEmployeeId: 'emp-2' }, 'emp-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.escalation.update).not.toHaveBeenCalled();
    });

    it('rechaza delegar un caso ya RESOLVED (409)', async () => {
      prisma.escalation.findUnique.mockResolvedValue({
        ...pending,
        status: 'RESOLVED',
      });

      await expect(
        service.delegate('esc-1', { toEmployeeId: 'emp-2' }, 'emp-1'),
      ).rejects.toThrow(ConflictException);
      expect(employees.findById).not.toHaveBeenCalled();
    });
  });
  /**
   * ⭐ US4 / FR-010 — derivar lo que no me corresponde.
   *
   * Es la contracara de US2: a un responsable la baja confianza no le crea ningún
   * caso, así que cuando el tema es de otra área necesita poder pasárselo a quien
   * sí lo sabe. El caso se crea recién en ese momento, y por decisión suya.
   */
  describe('delegateFromConversation (derivar desde el chat propio)', () => {
    const consulta =
      '¿cuál es el recargo por pagar una cuota fuera de término?';

    beforeEach(() => {
      conversations.getLastUserMessage.mockResolvedValue({ content: consulta });
      // No hay ningún caso previo: es justamente lo que US2 garantiza.
      prisma.escalation.findFirst.mockResolvedValue(null);
      prisma.escalation.create.mockResolvedValue({
        id: 'esc-nueva',
        conversationId: 'conv-1',
        status: 'PENDING',
      });
      prisma.escalation.findUnique.mockResolvedValue({
        id: 'esc-nueva',
        conversationId: 'conv-1',
        status: 'PENDING',
      });
      employees.findById.mockResolvedValue({
        id: 'emp-cobranzas',
        role: 'SUPERVISOR',
        isActive: true,
      });
      prisma.escalation.update.mockResolvedValue({
        id: 'esc-nueva',
        delegatedToId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });
    });

    it('a la persona elegida le entra el caso', async () => {
      const result = await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.create).toHaveBeenCalled();
      expect(result.delegatedToId).toBe('emp-cobranzas');
    });

    it('queda registrado quién derivó', async () => {
      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            delegatedToId: 'emp-cobranzas',
            delegatedById: 'emp-ventas',
          }),
        }),
      );
    });

    it('y quién lo resolvió, cuando quien lo recibe lo cierra', async () => {
      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      await service.resolve(
        'esc-nueva',
        { message: 'El recargo es del 10% mensual.' },
        'emp-cobranzas',
      );

      expect(prisma.escalation.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedById: 'emp-cobranzas',
          }),
        }),
      );
    });

    /**
     * El contexto sale de la conversación y no del cuerpo del request. Si viniera
     * de ahí, el caso podría llegarle a otra persona con un texto distinto del que
     * realmente se preguntó.
     */
    it('el caso llega con la consulta que de verdad se hizo', async () => {
      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: expect.stringContaining('recargo por pagar una cuota'),
          }),
        }),
      );
      const [, , nota] = conversations.addAgentNote.mock.calls[0];
      expect(nota).toContain(consulta);
    });

    // Derivarse el caso a sí mismo sería reproducir a mano el defecto que esta
    // spec vino a arreglar.
    it('rechaza derivarse la consulta a sí mismo (409)', async () => {
      await expect(
        service.delegateFromConversation({
          conversationId: 'conv-1',
          toEmployeeId: 'emp-ventas',
          delegatedById: 'emp-ventas',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.escalation.create).not.toHaveBeenCalled();
    });

    it('404 si la conversación no existe', async () => {
      conversations.findById.mockResolvedValue(null);

      await expect(
        service.delegateFromConversation({
          conversationId: 'conv-inexistente',
          toEmployeeId: 'emp-cobranzas',
          delegatedById: 'emp-ventas',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // Reusa create(), que ya no duplica: si por otra vía ya había un caso abierto,
    // se delega ESE en vez de abrir un segundo.
    it('no abre un segundo caso si ya había uno pendiente', async () => {
      prisma.escalation.findFirst.mockResolvedValue({
        id: 'esc-previa',
        conversationId: 'conv-1',
        status: 'PENDING',
      });
      prisma.escalation.findUnique.mockResolvedValue({
        id: 'esc-previa',
        conversationId: 'conv-1',
        status: 'PENDING',
      });

      await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-cobranzas',
        delegatedById: 'emp-ventas',
      });

      expect(prisma.escalation.create).not.toHaveBeenCalled();
      expect(prisma.escalation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'esc-previa' } }),
      );
    });

    /**
     * CL-3 — en el gerente el circuito termina, y eso es correcto.
     *
     * Es responsable de todas las áreas: no hay nadie "por encima" a quien pasarle
     * el tema. Lo que se comprueba es que eso no sea un agujero: derivar hacia él
     * deja el caso EN él y no genera ninguna derivación adicional automática. Puede
     * pasárselo a un supervisor, pero nunca se le crea un caso a él solo.
     */
    it('el circuito termina en el gerente: derivarle un caso no genera otro', async () => {
      employees.findById.mockResolvedValue({
        id: 'emp-gerente',
        role: 'SUPERVISOR',
        isActive: true,
      });
      prisma.escalation.update.mockResolvedValue({
        id: 'esc-nueva',
        delegatedToId: 'emp-gerente',
        delegatedById: 'emp-ventas',
      });

      const result = await service.delegateFromConversation({
        conversationId: 'conv-1',
        toEmployeeId: 'emp-gerente',
        delegatedById: 'emp-ventas',
      });

      expect(result.delegatedToId).toBe('emp-gerente');
      // Un solo caso, un solo delegate: nada se propaga hacia arriba.
      expect(prisma.escalation.create).toHaveBeenCalledTimes(1);
      expect(prisma.escalation.update).toHaveBeenCalledTimes(1);
    });
  });
});
