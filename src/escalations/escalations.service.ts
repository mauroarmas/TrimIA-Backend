import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Audience } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { EmployeesService } from '../employees/employees.service';

export interface ListEscalationsFilter {
  status?: 'PENDING' | 'RESOLVED';
  page?: number;
  limit?: number;
}

export interface ResolveEscalationInput {
  message: string;
  teachAgent?: boolean;
}

/**
 * Casos escalados por baja confianza (Sprint 3 — human-in-the-loop).
 * Antes de esta feature, `escalate_to_human` (rag-agent.graph.ts) solo
 * devolvía un mensaje canned: nada quedaba registrado ni consultable. Este
 * servicio es la fuente de verdad de la "cola de pendientes" del Panel del
 * Supervisor — ver specs/001-human-in-the-loop/data-model.md.
 */
@Injectable()
export class EscalationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly sender: WhatsappSenderService,
    private readonly logger: OrchestrationLogger,
    private readonly knowledge: KnowledgeService,
    private readonly employees: EmployeesService,
  ) {}

  /**
   * Crea un caso pendiente y deja la conversación en WAITING_HUMAN.
   * Si ya existe una PENDING para la misma conversación, la devuelve tal
   * cual en vez de duplicarla (regla de aplicación, no constraint de DB —
   * ver data-model.md).
   */
  async create(params: { conversationId: string; reason: string }) {
    const existing = await this.prisma.escalation.findFirst({
      where: { conversationId: params.conversationId, status: 'PENDING' },
    });
    if (existing) return existing;

    const escalation = await this.prisma.escalation.create({
      data: { conversationId: params.conversationId, reason: params.reason },
    });

    await this.conversations.setStatus(params.conversationId, 'WAITING_HUMAN');

    await this.logger.logEvent({
      conversationId: params.conversationId,
      eventType: 'escalation_created',
      payload: { reason: params.reason },
    });

    return escalation;
  }

  /** Lista casos, paginados (default: PENDING). */
  async listPending(filter: ListEscalationsFilter = {}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;
    const where = { status: filter.status ?? 'PENDING' } as const;

    const [data, total] = await Promise.all([
      this.prisma.escalation.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
        include: {
          conversation: {
            select: {
              externalId: true,
              channel: true,
              userType: true,
              currentAgent: true,
            },
          },
        },
      }),
      this.prisma.escalation.count({ where }),
    ]);

    return { data, total, page, limit, hasMore: skip + data.length < total };
  }

  async findById(id: string) {
    const escalation = await this.prisma.escalation.findUnique({
      where: { id },
      include: { conversation: true },
    });
    if (!escalation) {
      throw new NotFoundException('Caso pendiente no encontrado');
    }
    return escalation;
  }

  /**
   * Responde el caso: envía el mensaje al usuario, vuelve la conversación a
   * ACTIVE y marca la Escalation RESOLVED. `teachAgent` se implementa en la
   * Historia 4 (ver EscalationsService.resolve() extendido más abajo en el
   * historial de esta clase, tarea T024) — acá se ignora si viene.
   */
  async resolve(
    id: string,
    input: ResolveEscalationInput,
    resolvedById: string,
  ) {
    const escalation = await this.prisma.escalation.findUnique({
      where: { id },
    });
    if (!escalation) {
      throw new NotFoundException('Caso pendiente no encontrado');
    }
    if (escalation.status !== 'PENDING') {
      throw new ConflictException('Este caso ya fue resuelto');
    }

    const conversation = await this.conversations.findById(
      escalation.conversationId,
    );
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }

    await this.sender.send(
      conversation.externalId,
      input.message,
      conversation.channel,
    );
    await this.conversations.addMessage(
      conversation.id,
      'ASSISTANT',
      input.message,
      conversation.currentAgent ?? undefined,
    );
    await this.conversations.setStatus(conversation.id, 'ACTIVE');

    const resolved = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedById,
        resolution: input.message,
        resolvedAt: new Date(),
      },
    });

    await this.logger.logEvent({
      conversationId: conversation.id,
      eventType: 'escalation_resolved',
      payload: { resolvedById, teachAgent: !!input.teachAgent },
    });

    if (input.teachAgent) {
      const audience =
        conversation.userType === 'EMPLEADO' ? Audience.INTERNO : Audience.PUBLICO;
      await this.knowledge.ingest({
        title: `Resolución escalado ${escalation.id}`,
        content: input.message,
        category: 'escalado',
        audience,
        agentType: conversation.currentAgent,
      });
    }

    return resolved;
  }

  /** Reasigna el caso a otro supervisor (Historia 3). */
  async delegate(
    id: string,
    params: { toEmployeeId: string },
    delegatedById: string,
  ) {
    const escalation = await this.prisma.escalation.findUnique({
      where: { id },
    });
    if (!escalation) {
      throw new NotFoundException('Caso pendiente no encontrado');
    }
    if (escalation.status !== 'PENDING') {
      throw new ConflictException('Este caso ya fue resuelto');
    }

    const target = await this.employees.findById(params.toEmployeeId);
    if (target.role !== 'SUPERVISOR' || !target.isActive) {
      throw new ConflictException(
        'Solo se puede delegar a un supervisor activo',
      );
    }

    const updated = await this.prisma.escalation.update({
      where: { id },
      data: {
        delegatedToId: params.toEmployeeId,
        delegatedById,
        delegatedAt: new Date(),
      },
    });

    await this.logger.logEvent({
      conversationId: escalation.conversationId,
      eventType: 'escalation_delegated',
      payload: { toEmployeeId: params.toEmployeeId, delegatedById },
    });

    return updated;
  }
}
