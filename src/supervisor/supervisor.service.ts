import { Injectable } from '@nestjs/common';
import { AgentType, Channel, ConvStatus, UserType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface GetConversationsFilter {
  status?: ConvStatus;
  channel?: Channel;
  userType?: UserType;
  agentType?: AgentType;
  page?: number;   // 1-indexed
  limit?: number;  // default 20, max 100
}

export interface GetEventsFilter {
  conversationId?: string;
  eventType?: string;
  agentType?: AgentType;
  after?: Date;
  page?: number;   // 1-indexed
  limit?: number;  // default 20, max 100
}

/**
 * Métricas que consume el Panel del Supervisor (módulo de gobernanza del frontend).
 * Son agregados de datos que el sistema YA genera en cada mensaje:
 *  - TokenUsage         → consumo por agente
 *  - OrchestrationEvent → ruteos y handoffs (auditoría)
 *  - Conversation       → conversaciones activas y por agente
 */
export interface SupervisorMetrics {
  conversations: {
    total: number;
    active: number;
    byAgent: Record<string, number>;
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    byAgent: Record<string, { input: number; output: number }>;
  };
  events: { byType: Record<string, number> };
  recentEvents: {
    createdAt: Date;
    eventType: string;
    agentType: string | null;
  }[];
}

@Injectable()
export class SupervisorService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(): Promise<SupervisorMetrics> {
    // Una sola tanda de queries en paralelo (no dependen entre sí).
    const [total, active, convByAgent, tokensByAgent, eventsByType, recentEvents] =
      await Promise.all([
        this.prisma.conversation.count(),
        this.prisma.conversation.count({ where: { status: 'ACTIVE' } }),
        this.prisma.conversation.groupBy({
          by: ['currentAgent'],
          _count: { _all: true },
        }),
        this.prisma.tokenUsage.groupBy({
          by: ['agentType'],
          _sum: { inputTokens: true, outputTokens: true },
        }),
        this.prisma.orchestrationEvent.groupBy({
          by: ['eventType'],
          _count: { _all: true },
        }),
        // Solo metadatos del evento — NO el payload (puede tener contenido del
        // mensaje). El drill-down con contenido llega con el panel completo + auth.
        this.prisma.orchestrationEvent.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { createdAt: true, eventType: true, agentType: true },
        }),
      ]);

    const convAgentMap: Record<string, number> = {};
    for (const row of convByAgent) {
      convAgentMap[row.currentAgent ?? 'sin asignar'] = row._count._all;
    }

    const tokensAgentMap: Record<string, { input: number; output: number }> = {};
    for (const row of tokensByAgent) {
      tokensAgentMap[row.agentType] = {
        input: row._sum.inputTokens ?? 0,
        output: row._sum.outputTokens ?? 0,
      };
    }

    const eventsTypeMap: Record<string, number> = {};
    for (const row of eventsByType) {
      eventsTypeMap[row.eventType] = row._count._all;
    }

    const totals = Object.values(tokensAgentMap);
    return {
      conversations: { total, active, byAgent: convAgentMap },
      tokens: {
        totalInput: totals.reduce((a, b) => a + b.input, 0),
        totalOutput: totals.reduce((a, b) => a + b.output, 0),
        byAgent: tokensAgentMap,
      },
      events: { byType: eventsTypeMap },
      recentEvents,
    };
  }

  /**
   * Lista conversaciones con paginación (para el panel de supervisor).
   * Devuelve { data, total, page, limit, hasMore }.
   */
  async getConversations(filter: GetConversationsFilter = {}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.channel) where.channel = filter.channel;
    if (filter.userType) where.userType = filter.userType;
    if (filter.agentType) where.currentAgent = filter.agentType;

    const [data, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          externalId: true,
          channel: true,
          status: true,
          userType: true,
          currentAgent: true,
          agentLockedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      hasMore: skip + data.length < total,
    };
  }

  /**
   * Detalle completo de una conversación para el panel del supervisor.
   * Incluye mensajes, eventos de orquestación y totales de tokens.
   * Retorna null si no existe (el controller devuelve 404).
   */
  async getConversationDetail(conversationId: string) {
    const [conversation, messages, events, tokenTotals] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
      }),

      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          agentType: true,
          createdAt: true,
        },
      }),

      this.prisma.orchestrationEvent.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          eventType: true,
          agentType: true,
          payload: true,
          createdAt: true,
        },
      }),

      this.prisma.tokenUsage.aggregate({
        where: { conversationId },
        _sum: { inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
    ]);

    if (!conversation) return null;

    return {
      ...conversation,
      messages,
      events,
      tokens: {
        calls: tokenTotals._count._all,
        totalInput: tokenTotals._sum.inputTokens ?? 0,
        totalOutput: tokenTotals._sum.outputTokens ?? 0,
      },
    };
  }

  /**
   * Lista eventos de orquestación con filtros y paginación.
   * Usado para auditoría y timeline de actividad (OE-11).
   */
  async getEvents(filter: GetEventsFilter = {}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.conversationId) where.conversationId = filter.conversationId;
    if (filter.eventType) where.eventType = filter.eventType;
    if (filter.agentType) where.agentType = filter.agentType;
    if (filter.after) where.createdAt = { gte: filter.after };

    const [data, total] = await Promise.all([
      this.prisma.orchestrationEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.orchestrationEvent.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      hasMore: skip + data.length < total,
    };
  }
}