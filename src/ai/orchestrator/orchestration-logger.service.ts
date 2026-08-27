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
   *
   * ⚠️ **Se filtran los documentos que ya no existen en Postgres antes de
   * insertar** (defecto del 2026-08-26). `createMany` es todo-o-nada: un solo
   * `documentId` sin fila en `KnowledgeDocument` viola el FK y tira la tanda
   * ENTERA, incluidos los documentos válidos del mismo turno. Y como esto es
   * telemetría envuelta en un `try`, el turno seguía normal y no quedaba
   * rastro visible.
   *
   * El daño no era "una métrica perdida": si el turno escaló, esas filas son
   * las que después le muestran al supervisor **qué documentos quedaron
   * cortos**. Tres vectores huérfanos en Chroma —documentos borrados de
   * Postgres cuyos chunks sobrevivieron— dejaban casos enteros sin candidatos,
   * y la pantalla decía "no hay" en vez de "no se pudo guardar".
   *
   * Limpiar los huérfanos arregla el caso conocido; filtrar acá arregla la
   * clase entera. Las dos cosas: el corpus y Chroma pueden desincronizarse de
   * más de una manera, y ninguna de ellas debería costar la telemetría del
   * turno completo.
   */
  async trackRetrievals(params: {
    conversationId?: string | null;
    agentType?: AgentType | null;
    outcome: RetrievalOutcome;
    docs: RetrievedDoc[];
    /**
     * Caso creado en este turno, si el turno escaló (spec 007).
     *
     * Enlaza estos documentos con el caso concreto en vez de dejar que haya que
     * correlacionarlos por fecha después. Es lo que permite ofrecerle al
     * supervisor los documentos que quedaron cortos al resolverlo.
     */
    escalationId?: string | null;
  }) {
    if (params.docs.length === 0) return;

    // Un fallo acá no puede tumbar el turno: la respuesta ya se le envió al
    // usuario y esto es telemetría. Reintentar el job por una métrica
    // perdida le mandaría el mensaje dos veces.
    try {
      const existentes = await this.prisma.knowledgeDocument.findMany({
        where: { id: { in: params.docs.map((d) => d.documentId) } },
        select: { id: true },
      });
      const conFila = new Set(existentes.map((d) => d.id));
      const guardables = params.docs.filter((d) => conFila.has(d.documentId));

      // Un huérfano no es un detalle de implementación: significa que la
      // búsqueda le está devolviendo al agente un documento que el panel ya no
      // muestra y que nadie puede corregir. Se avisa con los ids para que se
      // pueda ir a limpiarlos, en vez de dejarlo pasar en silencio.
      if (guardables.length < params.docs.length) {
        const huerfanos = params.docs
          .filter((d) => !conFila.has(d.documentId))
          .map((d) => d.documentId);
        this.logger.warn(
          `${huerfanos.length} documento(s) recuperado(s) no existen en Postgres ` +
            `y se excluyen del registro: ${huerfanos.join(', ')}. ` +
            `Están en Chroma pero no en el corpus — hay que limpiar esos vectores.`,
        );
      }

      if (guardables.length === 0) return;

      await this.prisma.knowledgeRetrieval.createMany({
        data: guardables.map((d) => ({
          documentId: d.documentId,
          conversationId: params.conversationId ?? null,
          escalationId: params.escalationId ?? null,
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
