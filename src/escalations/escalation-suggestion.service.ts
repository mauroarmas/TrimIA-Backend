import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Audience, UserType } from '@prisma/client';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../ai/llm/llm.service';
import { KnowledgeService, SearchHit } from '../ai/knowledge/knowledge.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';

/** Lo que se le devuelve al supervisor cuando no hay con qué redactar. */
const NO_CONTEXT_REASON =
  'No hay información cargada sobre este tema con confianza suficiente. ' +
  'Redactá la respuesta y marcá «enseñar al agente» para incorporarla.';

const SUGGESTION_PROMPT =
  'Sos un asistente que le propone a un supervisor de una empresa comercial argentina ' +
  'cómo responder una consulta que el sistema no pudo resolver solo. ' +
  'Redactá una respuesta clara y cordial en español rioplatense, en segunda persona, ' +
  'usando ÚNICAMENTE la información del contexto que se te da. ' +
  'Si el contexto no alcanza para responder alguna parte de la consulta, no la respondas: ' +
  'es preferible una propuesta incompleta que una inventada, porque el supervisor la va a ' +
  'mandar tal cual y no tiene cómo saber qué parte salió del conocimiento cargado. ' +
  'No saludes ni te despidas: el supervisor edita el texto antes de enviarlo.';

export interface SuggestionSource {
  documentId: string;
  title: string;
  /** Score en porcentaje, como lo muestra el panel. */
  score: number;
}

export interface SuggestionResult {
  suggestion: string | null;
  hasContext: boolean;
  reason?: string;
  sources: SuggestionSource[];
  /** Se devuelve para que la audiencia usada sea visible, no implícita. */
  audienceUsed: Audience;
}

/**
 * Propuesta de respuesta para un caso escalado (US3, FR-034/FR-035).
 *
 * **La audiencia sale de la conversación escalada, no de quien consulta.**
 * Es el punto donde el Principio I es más fácil de romper sin darse cuenta:
 * quien pide la propuesta es siempre un SUPERVISOR, así que derivarla del
 * usuario autenticado daría `INTERNO` *siempre*, y el sistema redactaría con
 * conocimiento interno una respuesta destinada a un **cliente**. La regla vive
 * acá y en un test dedicado (research §12).
 *
 * `audienceUsed` viaja en la respuesta a propósito: hace la decisión visible
 * en la pantalla y verificable en un test, en vez de enterrada en el código.
 */
@Injectable()
export class EscalationSuggestionService {
  private readonly log = new Logger(EscalationSuggestionService.name);
  private readonly confidenceThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
    private readonly logger: OrchestrationLogger,
    config: ConfigService,
  ) {
    // Mismo umbral que usan los agentes para decidir si escalan. Si acá fuera
    // más permisivo, el sistema propondría con un contexto que él mismo
    // consideró insuficiente para responder — la contradicción exacta que
    // originó la escalación.
    this.confidenceThreshold = config.get<number>('RAG_CONFIDENCE_THRESHOLD')!;
  }

  async suggest(escalationId: string): Promise<SuggestionResult> {
    const escalation = await this.prisma.escalation.findUnique({
      where: { id: escalationId },
      include: { conversation: true },
    });
    if (!escalation) {
      throw new NotFoundException('Caso pendiente no encontrado');
    }

    const { conversation } = escalation;
    const audience = audienceFor(conversation.userType);
    const query = await this.buildQuery(
      escalation.conversationId,
      escalation.reason,
    );

    const hits = await this.knowledge.search(query, {
      audience,
      agentType: conversation.currentAgent ?? undefined,
      k: 4,
    });

    const confidence = hits[0]?.score ?? 0;
    const sources = hits.map((h) => ({
      documentId: h.documentId,
      title: h.title,
      score: Number((h.score * 100).toFixed(1)),
    }));

    // Dos filtros, no uno. El score dice si hay material *del tema*; que el
    // modelo devuelva texto dice si ese material *responde la consulta*.
    //
    // El segundo no sobra: probando con datos reales, un CLIENTE preguntando
    // por adelanto de cuotas recuperó documentos de medios de pago con score
    // suficiente, ninguno de los cuales contestaba la pregunta. El modelo hizo
    // lo correcto —no inventó, devolvió vacío— y sin este chequeo la pantalla
    // habría mostrado `hasContext: true` con un cuadro en blanco: el
    // supervisor sin saber si el sistema falló o si no hay nada que decir.
    const suggestion =
      confidence >= this.confidenceThreshold
        ? await this.draft(query, hits)
        : '';

    if (!suggestion) {
      // Deliberado: NO se devuelve un texto redactado sin respaldo. Una
      // propuesta escrita de memoria es indistinguible de una fundada, y el
      // supervisor la enviaría creyendo que sale del corpus (Principio II).
      this.log.log(
        `Sin propuesta para la escalación ${escalationId} (confianza=${confidence.toFixed(2)})`,
      );
      await this.logEvent(escalation.conversationId, false, audience, sources);
      return {
        suggestion: null,
        hasContext: false,
        reason: NO_CONTEXT_REASON,
        sources: [],
        audienceUsed: audience,
      };
    }

    // Se persiste para auditoría, NO como resolución: el caso sigue PENDING y
    // lo que se envíe será siempre el texto que el supervisor confirme.
    await this.prisma.escalation.update({
      where: { id: escalationId },
      data: { suggestedResponse: suggestion, suggestedAt: new Date() },
    });

    await this.logEvent(escalation.conversationId, true, audience, sources);

    return { suggestion, hasContext: true, sources, audienceUsed: audience };
  }

  /**
   * La consulta a buscar es el último mensaje del usuario, no el `reason` de
   * la escalación: el motivo lo escribió el agente ("baja confianza"), y
   * buscar eso recuperaría cualquier cosa. Si no hay mensaje, se cae al
   * motivo antes que fallar.
   */
  private async buildQuery(
    conversationId: string,
    fallback: string,
  ): Promise<string> {
    const lastUserMessage = await this.prisma.message.findFirst({
      where: { conversationId, role: 'USER' },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    return lastUserMessage?.content ?? fallback;
  }

  private async draft(query: string, hits: SearchHit[]): Promise<string> {
    const context = hits.map((h) => `- ${h.content}`).join('\n');
    const response = await this.llm.chat.invoke([
      new SystemMessage(SUGGESTION_PROMPT),
      new HumanMessage(
        `Consulta del usuario:\n${query}\n\nContexto disponible:\n${context}`,
      ),
    ]);
    return String(response.content).trim();
  }

  private async logEvent(
    conversationId: string,
    hasContext: boolean,
    audienceUsed: Audience,
    sources: SuggestionSource[],
  ): Promise<void> {
    await this.logger.logEvent({
      conversationId,
      eventType: 'escalation_suggestion_generated',
      // `audienceUsed` queda en el evento y no solo en la respuesta HTTP: es
      // lo que permite auditar después con qué audiencia se redactó cada
      // propuesta (OE-11).
      payload: {
        hasContext,
        audienceUsed,
        sourceIds: sources.map((s) => s.documentId),
      },
    });
  }
}

/**
 * CLIENTE → PUBLICO, EMPLEADO → INTERNO (que incluye lo público).
 *
 * Misma tabla que aplica `retrieve_context` en `rag-agent.graph.ts`: si un
 * cliente no puede ver un documento preguntándole al agente, tampoco puede
 * verlo a través de una respuesta que un supervisor le reenvía.
 */
function audienceFor(userType: UserType): Audience {
  return userType === UserType.EMPLEADO ? Audience.INTERNO : Audience.PUBLICO;
}
