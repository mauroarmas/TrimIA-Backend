import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentType,
  Channel,
  ConvStatus,
  Prisma,
  UserType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ALL_AGENTS } from '../ai/agents/agent-domains';

export interface GetConversationsFilter {
  status?: ConvStatus;
  channel?: Channel;
  userType?: UserType;
  agentType?: AgentType;
  page?: number; // 1-indexed
  limit?: number; // default 20, max 100
}

export interface GetEventsFilter {
  conversationId?: string;
  eventType?: string;
  agentType?: AgentType;
  after?: Date;
  page?: number; // 1-indexed
  limit?: number; // default 20, max 100
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
  /** Turnos ruteados a este agente EN LA VENTANA (base de las métricas de abajo). */
  routedTurns: number;
  /**
   * Proporción de turnos ruteados con confianza ≥ umbral, 0-1 (spec 009,
   * FR-017). `null` si `hasData` es false — nunca `0`: un agente sin muestra
   * suficiente no es lo mismo que uno que contestó mal siempre.
   */
  coverage: number | null;
  /**
   * `avg(confidence) − umbral`, en puntos porcentuales y con signo (spec 009,
   * FR-017a). Reemplaza a `avgConfidence`: la cobertura sola no distingue un
   * corpus holgado de uno que aprueba raspando, y expresado como distancia
   * al umbral no admite la lectura de "nota" que el 0-100% invitaba.
   * `null` si `hasData` es false.
   */
  marginPoints: number | null;
  /** Turnos que terminaron escalando a un humano por baja confianza. */
  escalations: number;
  /** escalations / routedTurns (0 si no hubo turnos). */
  escalationRate: number;
  /** Mismo valor que `routedTurns`, nombrado explícito para viajar siempre —
   *  incluso con `hasData: false`, donde `coverage`/`marginPoints` no dicen
   *  nada por sí solos (spec 009, FR-016). */
  sampleSize: number;
  /** `sampleSize >= minimumSample`. Distingue "sin datos" de "cobertura cero". */
  hasData: boolean;
  /** `COVERAGE_MIN_SAMPLE` vigente, para que el panel pueda decir "N de M". */
  minimumSample: number;
  /** Ventana efectivamente usada para este cálculo. */
  windowFrom: Date;
  windowTo: Date;
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

  /**
   * Resuelve los AgentTypes permitidos para el supervisor.
   * - Si es Diego Bazán o supervisa todos los sectores -> devuelve `null` (acceso irrestricto).
   * - Si es un supervisor de área específica (ej. Silvia Ríos) -> devuelve sus AgentTypes asociados.
   */
  async resolveAllowedAgents(callerId?: string): Promise<AgentType[] | null> {
    if (!callerId) return null;

    const [totalSectors, employee] = await Promise.all([
      this.prisma.sector.count(),
      this.prisma.employee.findUnique({
        where: { id: callerId },
        include: {
          areasSupervisadas: {
            select: { id: true, name: true, agentType: true },
          },
        },
      }),
    ]);

    if (!employee) return [];

    // Diego Bazán o quien supervise todos los sectores tiene acceso global
    if (
      employee.email === 'diego.bazan@credimision.com' ||
      (employee.areasSupervisadas?.length ?? 0) >= totalSectors
    ) {
      return null;
    }

    const allowed = (employee.areasSupervisadas ?? [])
      .map((a) => a.agentType)
      .filter((t): t is AgentType => t !== null);

    return allowed;
  }

  async getMetrics(callerId?: string): Promise<SupervisorMetrics> {
    const allowedAgents = await this.resolveAllowedAgents(callerId);

    const convWhere: any = {};
    const activeWhere: any = { status: 'ACTIVE' };
    const tokensWhere: any = {};
    const eventsWhere: any = {};

    if (allowedAgents !== null) {
      convWhere.currentAgent = { in: allowedAgents };
      activeWhere.currentAgent = { in: allowedAgents };
      tokensWhere.agentType = { in: allowedAgents };
      eventsWhere.agentType = { in: allowedAgents };
    }

    // Una sola tanda de queries en paralelo (no dependen entre sí).
    const [
      total,
      active,
      convByAgent,
      tokensByAgent,
      eventsByType,
      recentEvents,
    ] = await Promise.all([
      this.prisma.conversation.count({ where: convWhere }),
      this.prisma.conversation.count({ where: activeWhere }),
      this.prisma.conversation.groupBy({
        by: ['currentAgent'],
        where: convWhere,
        _count: { _all: true },
      }),
      this.prisma.tokenUsage.groupBy({
        by: ['agentType'],
        where: tokensWhere,
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.orchestrationEvent.groupBy({
        by: ['eventType'],
        where: eventsWhere,
        _count: { _all: true },
      }),
      // Solo metadatos del evento — NO el payload (puede tener contenido del
      // mensaje). El drill-down con contenido llega con el panel completo + auth.
      this.prisma.orchestrationEvent.findMany({
        where: eventsWhere,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { createdAt: true, eventType: true, agentType: true },
      }),
    ]);

    const convAgentMap: Record<string, number> = {};
    for (const row of convByAgent) {
      convAgentMap[row.currentAgent ?? 'sin asignar'] = row._count._all;
    }

    const tokensAgentMap: Record<string, { input: number; output: number }> =
      {};
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
  async getConversations(
    filter: GetConversationsFilter = {},
    callerId?: string,
  ) {
    const allowedAgents = await this.resolveAllowedAgents(callerId);

    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.channel) where.channel = filter.channel;
    if (filter.userType) where.userType = filter.userType;

    if (allowedAgents !== null) {
      if (filter.agentType) {
        if (!allowedAgents.includes(filter.agentType)) {
          return {
            data: [],
            total: 0,
            page,
            limit,
            hasMore: false,
          };
        }
        where.currentAgent = filter.agentType;
      } else {
        where.currentAgent = { in: allowedAgents };
      }
    } else if (filter.agentType) {
      where.currentAgent = filter.agentType;
    }

    const [data, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          externalId: true,
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
   * Lanza ForbiddenException si el supervisor no tiene asignada esa área.
   */
  async getConversationDetail(conversationId: string, callerId?: string) {
    const allowedAgents = await this.resolveAllowedAgents(callerId);

    const [conversation, messages, events, tokenTotals, internalNotes] =
      await Promise.all([
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
            createdAt: true,
            eventType: true,
            agentType: true,
                        payload: true,
          },
        }),

        this.prisma.tokenUsage.aggregate({
          where: { conversationId },
          _sum: { inputTokens: true, outputTokens: true },
          _count: { _all: true },
        }),

        this.prisma.internalNote.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            content: true,
            createdAt: true,
                        authorAgentType: true,
            author: { select: { id: true, name: true } },
          },
        }),
      ]);

    if (!conversation) return null;

    if (
      allowedAgents !== null &&
      conversation.currentAgent &&
      !allowedAgents.includes(conversation.currentAgent)
    ) {
      throw new ForbiddenException(
        'No tiene permisos para ver conversaciones fuera de su área supervisada',
      );
    }

    return {
      ...conversation,
      messages,
      events,
      internalNotes,
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
   * Estado de los 5 agentes especializados (tarea 2.4 — mockup del Panel;
   * reescrito en la spec 009, US2). Combina:
   *  - Conversation  → cuántas conversaciones atiende cada agente y su actividad
   *    (siempre histórico: es sobre a quién está asignado HOY, no un turno).
   *  - OrchestrationEvent (ROUTED_TO_AGENT) → cobertura, margen y escalados,
   *    ahora acotados a una VENTANA.
   */
  async getAgentsStatus(callerId?: string): Promise<AgentsStatusResponse> {
    const allowedAgents = await this.resolveAllowedAgents(callerId);

    const confidenceThreshold = this.config.get<number>(
      'RAG_CONFIDENCE_THRESHOLD',
    )!;
    const minimumSample = this.config.get<number>('COVERAGE_MIN_SAMPLE')!;
    const windowDays = this.config.get<number>('COVERAGE_WINDOW_DAYS')!;
    const windowTo = new Date();
    const windowFrom = new Date(
      windowTo.getTime() - windowDays * 24 * 60 * 60 * 1000,
    );

    // Cobertura, margen y escalados por agente, agregados en Postgres sobre el JSON
    const eventStatsPromise = this.prisma.$queryRaw<
      {
        agentType: AgentType;
        avgConfidence: number | null;
        escalations: bigint;
        covered: bigint;
        routed: bigint;
      }[]
    >(Prisma.sql`
      SELECT "agentType",
             AVG((payload->>'confidence')::float)                                        AS "avgConfidence",
             COUNT(*) FILTER (WHERE payload->>'escalated' = 'true')                      AS "escalations",
             COUNT(*) FILTER (WHERE (payload->>'confidence')::float >= ${confidenceThreshold}) AS "covered",
             COUNT(*)                                                                    AS "routed"
      FROM "OrchestrationEvent"
      WHERE "eventType" = 'ROUTED_TO_AGENT' AND "agentType" IS NOT NULL
        AND "createdAt" >= ${windowFrom} AND "createdAt" < ${windowTo}
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

    const totalMap = new Map(totalByAgent.map((r) => [r.currentAgent, r]));
    const activeMap = new Map(
      activeByAgent.map((r) => [r.currentAgent, r._count._all]),
    );
    const statsMap = new Map(eventStats.map((r) => [r.agentType, r]));

    const targetAgents =
      allowedAgents !== null
        ? ALL_AGENTS.filter((a) => allowedAgents.includes(a))
        : ALL_AGENTS;

    const agents: AgentStatus[] = targetAgents.map((agentType) => {
      const total = totalMap.get(agentType);
      const active = activeMap.get(agentType) ?? 0;
      const stats = statsMap.get(agentType);

      const routedTurns = stats ? Number(stats.routed) : 0;
      const escalations = stats ? Number(stats.escalations) : 0;
      const covered = stats ? Number(stats.covered) : 0;
      const hasData = routedTurns >= minimumSample;
      const coverage = hasData
        ? Math.round((covered / routedTurns) * 1000) / 1000
        : null;
      const marginPoints =
        hasData && stats?.avgConfidence != null
          ? Math.round(
              (stats.avgConfidence * 100 - confidenceThreshold * 100) * 10,
            ) / 10
          : null;

      return {
        agentType,
        status: active > 0 ? 'active' : 'idle',
        totalConversations: total?._count._all ?? 0,
        activeConversations: active,
        lastActivityAt: total?._max.updatedAt ?? null,
        routedTurns,
        coverage,
        marginPoints,
        escalations,
        escalationRate: routedTurns > 0 ? escalations / routedTurns : 0,
        sampleSize: routedTurns,
        hasData,
        minimumSample,
        windowFrom,
        windowTo,
      };
    });

    return { confidenceThreshold, agents };
  }
}
