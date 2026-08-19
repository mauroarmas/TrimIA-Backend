import { Injectable, Logger } from '@nestjs/common';
import { AgentType, Prisma, RetrievalOutcome } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RetrievedDoc } from './orchestrator.state';

/**
 * Conecta los grafos de LangGraph con la capa de negocio (Prisma).
 * Escribe dos tipos de registros:
 *  - OrchestrationEvent → auditoría (qué pasó). Lo consume Paperclip.
 *  - TokenUsage         → análisis económico (cuántos tokens y cuánto tardó).
 */
@Injectable()
export class OrchestrationLogger {
  private readonly logger = new Logger(OrchestrationLogger.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Persiste un evento de orquestación (auditoría). */
  async logEvent(params: {
    conversationId?: string | null;
    eventType: string;
    agentType?: AgentType | null;
    payload: Prisma.InputJsonValue;
  }) {
    await this.prisma.orchestrationEvent.create({
      data: {
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

  /**
   * Registra qué documentos recuperó el RAG en un turno y cómo terminó
   * (Sprint 5A, US7, FR-046).
   *
   * Se llama DESPUÉS de resuelto el turno, no desde `retrieve_context`: el
   * `outcome` es justamente lo que ese nodo todavía no sabe (research §9).
   *
   * `skipDuplicates` cubre el caso de un documento que aparece dos veces en
   * el mismo top-k por tener dos chunks parecidos: interesa que el documento
   * se recuperó, no cuántos de sus pedazos entraron.
   */
  async trackRetrievals(params: {
    conversationId?: string | null;
    agentType?: AgentType | null;
    outcome: RetrievalOutcome;
    docs: RetrievedDoc[];
  }) {
    if (params.docs.length === 0) return;

    // Un fallo acá no puede tumbar el turno: la respuesta ya se le envió al
    // usuario y esto es telemetría. Reintentar el job por una métrica
    // perdida le mandaría el mensaje dos veces.
    try {
      await this.prisma.knowledgeRetrieval.createMany({
        data: params.docs.map((d) => ({
          documentId: d.documentId,
          conversationId: params.conversationId ?? null,
          score: d.score,
          rank: d.rank,
          agentType: params.agentType ?? null,
          outcome: params.outcome,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        `No se registraron las recuperaciones del turno: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
