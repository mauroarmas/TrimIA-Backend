import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

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
}