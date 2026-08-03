import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentType, Channel, ConvStatus, Prisma, UserType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ALL_AGENTS } from '../ai/agents/agent-domains';

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

/**
 * Estado operativo de un agente para el Panel del Supervisor (tarea 2.4).
 * Todos los valores derivan de datos que el sistema YA persiste; nada se inventa.
 */
export interface AgentStatus {
  agentType: string;
  /** 'active' si tiene al menos una conversación ACTIVE asignada; si no, 'idle'. */
  status: 'active' | 'idle';
  totalConversations: number;
  activeConversations: number;
  /** Última vez que se tocó una conversación de este agente (null si ninguna). */
  lastActivityAt: Date | null;
  /** Turnos ruteados a este agente (base de las métricas de abajo). */
  routedTurns: number;
  /** Confianza RAG promedio (0-1) de los turnos ruteados; null si aún no hay datos. */
  avgConfidence: number | null;
  /** Turnos que terminaron escalando a un humano por baja confianza. */
  escalations: number;
  /** escalations / routedTurns (0 si no hubo turnos). */
  escalationRate: number;
}

export interface AgentsStatusResponse {
  /** Umbral de confianza vigente (RAG_CONFIDENCE_THRESHOLD), para colorear el panel. */
  confidenceThreshold: number;
  agents: AgentStatus[];
}

@Injectable()
export class SupervisorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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

  /**
   * Estado de los 5 agentes especializados (tarea 2.4 — mockup del Panel).
   * Combina:
   *  - Conversation  → cuántas conversaciones atiende cada agente y su actividad.
   *  - OrchestrationEvent (ROUTED_TO_AGENT) → confianza RAG promedio y escalados.
   * La confianza sale del payload del evento, que el orquestador persiste por turno.
   */
  async getAgentsStatus(): Promise<AgentsStatusResponse> {
    const confidenceThreshold = this.config.get<number>(
      'RAG_CONFIDENCE_THRESHOLD',
      0.65,
    );

    // Confianza promedio y escalados por agente, agregados en Postgres sobre el
    // JSON del payload (AVG ignora los null de eventos previos a la tarea 2.4).
    const eventStatsPromise = this.prisma.$queryRaw<
      {
        agentType: AgentType;
        avgConfidence: number | null;
        escalations: bigint;
        routed: bigint;
      }[]
    >(Prisma.sql`
      SELECT "agentType",
             AVG((payload->>'confidence')::float)                              AS "avgConfidence",
             COUNT(*) FILTER (WHERE payload->>'escalated' = 'true')            AS "escalations",
             COUNT(*)                                                          AS "routed"
      FROM "OrchestrationEvent"
      WHERE "eventType" = 'ROUTED_TO_AGENT' AND "agentType" IS NOT NULL
      GROUP BY "agentType"
    `);

    const [totalByAgent, activeByAgent, eventStats] = await Promise.all([
      this.prisma.conversation.groupBy({
        by: ['currentAgent'],
        where: { currentAgent: { not: null } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      this.prisma.conversation.groupBy({
        by: ['currentAgent'],
        where: { currentAgent: { not: null }, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      eventStatsPromise,
    ]);

    const totalMap = new Map(
      totalByAgent.map((r) => [r.currentAgent, r]),
    );
    const activeMap = new Map(
      activeByAgent.map((r) => [r.currentAgent, r._count._all]),
    );
    const statsMap = new Map(eventStats.map((r) => [r.agentType, r]));

    const agents: AgentStatus[] = ALL_AGENTS.map((agentType) => {
      const total = totalMap.get(agentType);
      const active = activeMap.get(agentType) ?? 0;
      const stats = statsMap.get(agentType);

      const routedTurns = stats ? Number(stats.routed) : 0;
      const escalations = stats ? Number(stats.escalations) : 0;
      const avgConfidence =
        stats && stats.avgConfidence != null
          ? Math.round(stats.avgConfidence * 1000) / 1000
          : null;

      return {
        agentType,
        status: active > 0 ? 'active' : 'idle',
        totalConversations: total?._count._all ?? 0,
        activeConversations: active,
        lastActivityAt: total?._max.updatedAt ?? null,
        routedTurns,
        avgConfidence,
        escalations,
        escalationRate: routedTurns > 0 ? escalations / routedTurns : 0,
      };
    });

    return { confidenceThreshold, agents };
  }
}