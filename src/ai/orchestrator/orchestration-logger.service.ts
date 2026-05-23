import { Injectable } from '@nestjs/common';
import { AgentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Conecta los grafos de LangGraph con la capa de negocio (Prisma).
 * Escribe dos tipos de registros:
 *  - OrchestrationEvent → auditoría (qué pasó). Lo consume Paperclip.
 *  - TokenUsage         → análisis económico (cuántos tokens y cuánto tardó).
 */
@Injectable()
export class OrchestrationLogger {
  constructor(private readonly prisma: PrismaService) {}

  /** Persiste un evento de orquestación (auditoría). */
  async logEvent(params: {
    threadId: string;
    conversationId?: string | null;
    eventType: string;
    agentType?: AgentType | null;
    payload: Prisma.InputJsonValue;
  }) {
    await this.prisma.orchestrationEvent.create({
      data: {
        threadId: params.threadId,
        conversationId: params.conversationId ?? null,
        eventType: params.eventType,
        agentType: params.agentType ?? null,
        payload: params.payload,
      },
    });
  }

  /** Persiste el consumo de tokens + latencia de una llamada a Gemini. */
  async trackTokens(params: {
    conversationId?: string | null;
    agentType: AgentType;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    model: string;
  }) {
    await this.prisma.tokenUsage.create({
      data: {
        conversationId: params.conversationId ?? null,
        agentType: params.agentType,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        durationMs: params.durationMs,
        model: params.model,
      },
    });
  }
}