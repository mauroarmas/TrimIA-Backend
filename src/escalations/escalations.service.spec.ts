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

    it('con teachAgent: true, ingesta la respuesta al RAG con la audiencia derivada del userType', async () => {
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

      // conversation.userType = 'CLIENTE' → audiencia PUBLICO.
      expect(knowledge.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Sí, la tenemos en 12 cuotas.',
          audience: 'PUBLICO',
          agentType: conversation.currentAgent,
        }),
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
});
