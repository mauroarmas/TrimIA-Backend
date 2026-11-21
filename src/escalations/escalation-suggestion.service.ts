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

/**
 * Lo que se le dice cuando SÍ se redactó, pero con material por debajo del
 * umbral del agente. No es una advertencia genérica: nombra el hecho de que
 * este texto se apoya en lo mismo que al agente no le alcanzó.
 */
const RESPALDO_DEBIL_REASON =
  'Esta propuesta se redactó con material por debajo del umbral del agente: ' +
  'es justo lo que no le alcanzó para responder solo. Revisá contra las ' +
  'fuentes antes de enviarla.';

const SUGGESTION_PROMPT =
  'Sos un asistente que le propone a un supervisor de Credimisión (empresa comercial argentina) ' +
  'cómo responder una consulta escalada en WhatsApp o Chat Web.\n' +
  'Reglas estrictas:\n' +
  '1. Redactá una respuesta breve, clara, natural y cordial en español rioplatense (vos), lista para enviar al contacto.\n' +
  '2. Usá ÚNICAMENTE los datos del contexto documental y del borrador comercial/conversación provistos. Nunca inventes precios, cuotas, stock ni apruebes créditos.\n' +
  '3. REGLA CRÍTICA DE RELEVANCIA: Si los fragmentos del contexto documental tratan sobre OTRO tema que NO responde la consulta real del usuario ' +
  '(por ejemplo, el usuario pide un producto o cotización y los fragmentos hablan de horarios de atención o ubicación) y tampoco hay datos comerciales concretos para responderle, ' +
  'devolvé EXACTAMENTE una cadena vacía (sin texto, sin explicaciones, sin comillas). JAMÁS rellenes con información irrelevante.\n' +
  '4. Si hay datos de un producto o cotización comercial en el borrador, redactá una respuesta útil que confirme esos datos y guíe el siguiente paso concreto (por ejemplo, pedir los datos faltantes o confirmar el resumen) sin aprobar el crédito.\n' +
  '5. No incluyas saludos largos ni despedidas genéricas, ni menciones "según el contexto" o "documentos".';

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
  /**
   * La propuesta se apoya en material que NO le habría alcanzado al agente
   * (entre `SUGGESTION_CONFIDENCE_THRESHOLD` y `RAG_CONFIDENCE_THRESHOLD`).
   *
   * Va como campo aparte y no como un matiz de `hasContext` porque son dos
   * preguntas distintas: `hasContext` dice si hay algo que leer, esto dice
   * cuánto pesa. Sin él, bajar el umbral sería exactamente lo que el Principio
   * II prohíbe — una propuesta floja indistinguible de una fundada.
   */
  respaldoDebil: boolean;
  /** El score del mejor fragmento, 0-100, como lo muestra el panel. */
  confidence: number;
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
  /** Desde dónde se redacta (bajo). */
  private readonly suggestionThreshold: number;
  /** Desde dónde el agente habría contestado solo (alto). Marca el respaldo. */
  private readonly agentThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
    private readonly logger: OrchestrationLogger,
    config: ConfigService,
  ) {
    // Dos umbrales, y el de acá es el BAJO.
    //
    // Durante mucho tiempo fue uno solo, el del agente, con este argumento:
    // "si acá fuera más permisivo, el sistema propondría con un contexto que
    // él mismo consideró insuficiente". El argumento sonaba bien y dejaba el
    // botón muerto. Un caso de «confianza insuficiente» escaló *porque* midió
    // por debajo del umbral, y esta búsqueda es la MISMA —misma consulta, misma
    // audiencia, mismo agente, mismo k— así que volvía a dar lo mismo y no
    // redactaba nunca. Encontrado el 2026-08-26 probando el panel: 8 de los 10
    // casos abiertos eran de ese tipo.
    //
    // Lo que fallaba era equiparar dos decisiones distintas. El agente le
    // responde al cliente SOLO: ahí el umbral es lo único que separa una
    // respuesta buena de una inventada. La propuesta la lee, la corrige y la
    // manda un supervisor — la red de seguridad es la persona. Lo que el
    // Principio II exige no es negarse a redactar, es que el respaldo flojo se
    // VEA: por eso `respaldoDebil` y `confidence` viajan en la respuesta.
    //
    // El umbral del agente se sigue leyendo, ya no para decidir si se redacta
    // sino para saber cuándo avisar.
    this.suggestionThreshold = config.get<number>(
      'SUGGESTION_CONFIDENCE_THRESHOLD',
    )!;
    this.agentThreshold = config.get<number>('RAG_CONFIDENCE_THRESHOLD')!;
  }

  async suggest(escalationId: string): Promise<SuggestionResult> {
    const escalation = await this.prisma.escalation.findUnique({
      where: { id: escalationId },
      include: {
        conversation: true,
      },
    });
    if (!escalation) {
      throw new NotFoundException('Caso pendiente no encontrado');
    }

    const { conversation } = escalation;
    const audience = audienceFor(conversation.userType);
    const query = await this.buildQuery(
      escalation.conversationId,
      escalation.createdAt,
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

    const financingDraft = (conversation as { financingDraft?: Record<string, unknown> | null })
      .financingDraft ?? null;
    const hasCommercialDraft = Boolean(
      financingDraft &&
        (financingDraft.productSummary || financingDraft.amount || financingDraft.sku),
    );
    const recentHistory = await this.loadRecentHistory(
      escalation.conversationId,
      escalation.createdAt,
    );

    // Dos filtros, no uno. El score dice si hay material *del tema*; que el
    // modelo devuelva texto dice si ese material *responde la consulta*.
    const suggestion =
      confidence >= this.suggestionThreshold || hasCommercialDraft
        ? await this.draft(query, hits, {
            reason: escalation.reason,
            recentHistory,
            financingDraft,
          })
        : '';

    // Por debajo del umbral del AGENTE, aunque se haya redactado. El caso
    // típico es justamente éste: el material que no le alcanzó al agente para
    // contestar solo sí alcanza para que una persona lo revise y lo mande.
    const respaldoDebil = confidence < this.agentThreshold;
    const confidencePct = Number((confidence * 100).toFixed(1));

    if (!suggestion) {
      // Deliberado: NO se devuelve un texto redactado sin respaldo. Una
      // propuesta escrita de memoria es indistinguible de una fundada, y el
      // supervisor la enviaría creyendo que sale del corpus (Principio II).
      this.log.log(
        `Sin propuesta para la escalación ${escalationId} (confianza=${confidence.toFixed(2)})`,
      );
      await this.logEvent(
        escalation.conversationId,
        false,
        audience,
        sources,
        respaldoDebil,
        confidencePct,
      );
      // `sources` SÍ va, aunque no haya propuesta. Antes se devolvía vacío y
      // eso borraba el único dato útil de un caso sin respuesta: qué fue lo más
      // cercano y por cuánto no llegó. "No hay nada sobre este tema" y "lo hay
      // al 48%" piden trabajo distinto — cargar de cero o corregir lo que está.
      return {
        suggestion: null,
        hasContext: false,
        reason: NO_CONTEXT_REASON,
        sources,
        audienceUsed: audience,
        respaldoDebil,
        confidence: confidencePct,
      };
    }

    // Se persiste para auditoría, NO como resolución: el caso sigue PENDING y
    // lo que se envíe será siempre el texto que el supervisor confirme.
    await this.prisma.escalation.update({
      where: { id: escalationId },
      data: { suggestedResponse: suggestion, suggestedAt: new Date() },
    });

    if (respaldoDebil) {
      this.log.log(
        `Propuesta con respaldo débil para la escalación ${escalationId} ` +
          `(confianza=${confidence.toFixed(2)}, umbral del agente=${this.agentThreshold})`,
      );
    }

    await this.logEvent(
      escalation.conversationId,
      true,
      audience,
      sources,
      respaldoDebil,
      confidencePct,
    );

    return {
      suggestion,
      hasContext: true,
      sources,
      audienceUsed: audience,
      respaldoDebil,
      confidence: confidencePct,
      ...(respaldoDebil ? { reason: RESPALDO_DEBIL_REASON } : {}),
    };
  }

  /**
   * La consulta a buscar es el mensaje del usuario **que provocó el escalado**.
   *
   * Dos precisiones, y las dos costaron un defecto:
   *
   * 1. **No es el `reason`.** El motivo lo escribió el agente ("baja
   *    confianza"), y buscar eso recuperaría cualquier cosa.
   *
   * 2. **No es el último mensaje de la conversación** (defecto encontrado el
   *    2026-08-26). El escalado deja la conversación en `WAITING_HUMAN`, no
   *    cerrada: el cliente sigue escribiendo mientras espera. Para cuando el
   *    supervisor abre el caso, "el último mensaje" ya es otra consulta, y la
   *    propuesta se redactaba —o no— sobre un tema que nadie escaló.
   *
   *    El fallo era silencioso: la pantalla decía "no hay información cargada
   *    sobre este tema" cuando sí la había. Medido en el caso real, la consulta
   *    que escaló daba 71.2% y la que se buscaba 62.4%, contra un umbral de
   *    65% — nunca tan bajo como para parecer un bug.
   *
   *    Por eso se acota por `createdAt <= escalatedAt`: el último mensaje del
   *    usuario ANTERIOR al caso es exactamente el turno que no alcanzó el
   *    umbral.
   *
   * Si no hay ninguno (casos viejos, o creados a mano), se cae al motivo antes
   * que fallar.
   */
  private async buildQuery(
    conversationId: string,
    escalatedAt: Date,
    fallback: string,
  ): Promise<string> {
    const escalatingMessage = await this.prisma.message.findFirst({
      where: { conversationId, role: 'USER', createdAt: { lte: escalatedAt } },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    return escalatingMessage?.content ?? fallback;
  }

  private async loadRecentHistory(
    conversationId: string,
    escalatedAt: Date,
  ): Promise<string> {
    if (typeof this.prisma.message?.findMany !== 'function') {
      return '';
    }
    const rows = await this.prisma.message.findMany({
      where: { conversationId, createdAt: { lte: escalatedAt } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { role: true, content: true },
    });
    if (!rows?.length) return '';
    return rows
      .reverse()
      .map((m) => `${m.role === 'USER' ? 'Contacto' : 'Asistente'}: ${m.content}`)
      .join('\n');
  }

  private async draft(
    query: string,
    hits: SearchHit[],
    extra?: {
      reason?: string | null;
      recentHistory?: string;
      financingDraft?: Record<string, unknown> | null;
    },
  ): Promise<string> {
    const sections: string[] = [];
    if (extra?.reason) {
      sections.push(`Motivo de derivación:\n${extra.reason}`);
    }
    if (extra?.recentHistory) {
      sections.push(`Historial reciente de la conversación:\n${extra.recentHistory}`);
    }
    sections.push(`Consulta principal del contacto:\n${query}`);

    if (extra?.financingDraft) {
      const d = extra.financingDraft;
      const draftLines = [
        d.productSummary ? `Producto: ${String(d.productSummary)}` : null,
        d.amount != null ? `Precio/importe registrado: $${Number(d.amount).toLocaleString('es-AR')} ARS` : null,
        d.name ? `Nombre: ${String(d.name)}` : 'Nombre: pendiente',
        d.dni ? `DNI: ${String(d.dni)}` : 'DNI: pendiente',
        d.business ? `Comercio: ${String(d.business)}` : 'Comercio: pendiente',
        d.locality ? `Localidad: ${String(d.locality)}` : 'Localidad: pendiente',
      ].filter(Boolean);
      sections.push(`Datos del borrador comercial actual:\n${draftLines.join('\n')}`);
    }

    const context = hits.length
      ? hits.map((h) => `- [${h.title} (${Math.round(h.score * 100)}%)]: ${h.content}`).join('\n')
      : '(Sin documentos relevantes)';
    sections.push(`Contexto documental disponible:\n${context}`);

    const response = await this.llm.chat.invoke([
      new SystemMessage(SUGGESTION_PROMPT),
      new HumanMessage(sections.join('\n\n')),
    ]);
    const raw = String(response.content ?? '').trim();
    if (!raw || raw === '""' || raw === "''" || /^sin contexto/i.test(raw)) {
      return '';
    }
    return raw;
  }

  private async logEvent(
    conversationId: string,
    hasContext: boolean,
    audienceUsed: Audience,
    sources: SuggestionSource[],
    respaldoDebil: boolean,
    confidence: number,
  ): Promise<void> {
    await this.logger.logEvent({
      conversationId,
      eventType: 'escalation_suggestion_generated',
      // `audienceUsed` queda en el evento y no solo en la respuesta HTTP: es
      // lo que permite auditar después con qué audiencia se redactó cada
      // propuesta (OE-11).
      //
      // `respaldoDebil` y `confidence` también: bajar el umbral solo es
      // defendible si después se puede responder "¿con cuánto respaldo se
      // redactó lo que se le mandó al cliente?". Sin esto en el evento, esa
      // pregunta no tiene dónde contestarse.
      payload: {
        hasContext,
        audienceUsed,
        respaldoDebil,
        confidence,
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
