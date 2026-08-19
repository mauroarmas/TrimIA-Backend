import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentType,
  Audience,
  ConvStatus,
  EscalationStatus,
  KnowledgeSourceType,
  UserType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { EmployeesService } from '../employees/employees.service';

export interface ListEscalationsFilter {
  /** Los cuatro estados (Sprint 5A); el default sigue siendo PENDING. */
  status?: EscalationStatus;
  page?: number;
  limit?: number;
}

export interface ResolveEscalationInput {
  message: string;
  teachAgent?: boolean;
  /** Requeridos si teachAgent=true; ver ResolveEscalationDto. */
  title?: string;
  category?: string;
  audience?: Audience;
  agentType?: AgentType;
}

/**
 * "Aprobar y guardar" (FR-039). A diferencia de `resolve`, el título y la
 * categoría son obligatorios: acá la ingesta al RAG no es opcional — es el
 * único efecto de la acción, así que no tiene sentido permitirla sin los
 * datos que el documento necesita.
 */
export interface SaveUnsentInput {
  message: string;
  title: string;
  category: string;
  agentType?: AgentType;
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
  async create(params: {
    conversationId: string;
    reason: string;
    /** Agente que escaló; queda como autor de la nota interna. */
    agentType?: AgentType;
    /** Resumen del caso para el supervisor que lo tome. */
    internalNote?: string;
  }) {
    const existing = await this.prisma.escalation.findFirst({
      where: { conversationId: params.conversationId, status: 'PENDING' },
    });
    // Si ya hay un caso pendiente, tampoco se duplica la nota.
    if (existing) return existing;

    const escalation = await this.prisma.escalation.create({
      data: { conversationId: params.conversationId, reason: params.reason },
    });

    if (params.internalNote) {
      await this.conversations.addAgentNote(
        params.conversationId,
        params.agentType ?? null,
        params.internalNote,
      );
    }

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
   * ACTIVE y marca la Escalation RESOLVED. Si `teachAgent` es true, ingesta
   * la respuesta al RAG como `KnowledgeDocument` usando el título/categoría
   * que mande el supervisor (mismo shape que POST /knowledge).
   */
  async resolve(
    id: string,
    input: ResolveEscalationInput,
    resolvedById: string,
  ) {
    const { conversation } = await this.loadPending(id);

    // ⚠️ Spec 005, US5 — la otra puerta de atrás: "enseñarle al agente" ingesta un
    // documento, así que vale la misma regla de área que la pantalla de gestión.
    //
    // Se chequea ACÁ ARRIBA, antes de enviarle el mensaje al usuario. Si estuviera
    // junto al `ingest()` del final, un rechazo dejaría el caso resuelto y el
    // mensaje ya enviado, con un 403 que no se puede deshacer: el supervisor no
    // sabría si respondió o no. Rechazar antes de tocar nada deja el caso intacto
    // para que lo resuelva sin enseñar, o para que lo derive a quien sí puede.
    if (input.teachAgent) {
      await this.knowledge.assertPuedeEscribir(
        resolvedById,
        input.agentType ?? conversation.currentAgent,
      );
    }

    // Lo que se envía es SIEMPRE `input.message`, nunca
    // `escalation.suggestedResponse` (FR-036). Ahora que la propuesta se
    // persiste, mandar la sugerencia "porque ya está ahí" es una regresión
    // posible: sería enviarle al usuario un texto que ningún humano aprobó.
    // Va con test.
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
    await this.releaseConversation(conversation);

    const resolved = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: EscalationStatus.RESOLVED,
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
      // Antes se inferÍa PUBLICO cuando la conversación era con un CLIENTE.
      // Eso publicaba automáticamente lo que el supervisor tipeó para ESE
      // caso puntual — sin que lo decidiera a propósito — como conocimiento
      // servido a cualquier cliente futuro. Default seguro: INTERNO, igual
      // que knowledge.ingest() (knowledge.service.ts). Publicarlo requiere
      // que el supervisor mande audience: PUBLICO explícito.
      const audience = input.audience ?? Audience.INTERNO;
      await this.knowledge.ingest({
        title: input.title!,
        content: input.message,
        category: input.category!,
        audience,
        agentType: input.agentType ?? conversation.currentAgent,
        // Sprint 5A: el documento queda trazable hasta el caso que lo originó
        // (FR-026), igual que el de saveUnsent().
        sourceType: KnowledgeSourceType.ESCALADO,
        sourceId: id,
      });
    }

    return resolved;
  }

  /**
   * Aprobar y **guardar sin enviar** (US3, FR-039).
   *
   * El caso de uso: la consulta ya se resolvió por otra vía —el cliente llamó,
   * o alguien le contestó por afuera— pero la respuesta igual sirve para la
   * próxima vez. Mandarle el mensaje ahora sería redundante o confuso.
   *
   * El texto queda en `savedResponse` y **no** en `resolution`, a propósito:
   * así "hay algo en `resolution`" sigue significando "esto se le envió al
   * usuario", que es de lo que depende toda la lectura de auditoría del
   * Sprint 3.
   */
  async saveUnsent(
    id: string,
    input: SaveUnsentInput,
    savedById: string,
  ): Promise<{
    id: string;
    status: EscalationStatus;
    knowledgeDocumentId: string;
  }> {
    const { escalation, conversation } = await this.loadPending(id);

    // La audiencia sale del userType de la conversación, NO de quien guarda:
    // el que guarda es siempre un SUPERVISOR, y derivarla de él publicaría
    // como INTERNO algo escrito para un cliente — o peor, al revés. Mismo
    // riesgo que cubre EscalationSuggestionService (research §12).
    const audience =
      conversation.userType === UserType.EMPLEADO
        ? Audience.INTERNO
        : Audience.PUBLICO;

    // ⚠️ Spec 005, US5 — LA PUERTA DE ATRÁS. Esta acción ingesta **siempre**: es su
    // único efecto. Sin este chequeo, un responsable de Ventas mete un documento en
    // el corpus de Cobranzas guardando la respuesta de un caso, sin pasar por la
    // pantalla de gestión y sin que nada lo delate.
    //
    // Va ANTES de ingestar y antes de liberar la conversación: un rechazo tiene que
    // dejar el caso exactamente como estaba.
    const areaDelDocumento = input.agentType ?? conversation.currentAgent;
    await this.knowledge.assertPuedeEscribir(savedById, areaDelDocumento);

    const { documentId } = await this.knowledge.ingest({
      title: input.title,
      content: input.message,
      category: input.category,
      audience,
      agentType: areaDelDocumento,
      sourceType: KnowledgeSourceType.ESCALADO,
      sourceId: escalation.id,
    });

    await this.releaseConversation(conversation);

    const saved = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: EscalationStatus.SAVED_UNSENT,
        savedResponse: input.message,
        resolvedById: savedById,
        resolvedAt: new Date(),
      },
    });

    await this.logger.logEvent({
      conversationId: conversation.id,
      eventType: 'escalation_saved_unsent',
      payload: { savedById, knowledgeDocumentId: documentId, audience },
    });

    return {
      id: saved.id,
      status: saved.status,
      knowledgeDocumentId: documentId,
    };
  }

  /**
   * Descartar el caso (US3, FR-038).
   *
   * Sin mensaje y **sin ingesta**: una consulta puntual que no amerita
   * respuesta estándar no tiene por qué contaminar el corpus. El `reason` es
   * lo que hace auditable por qué alguien quedó sin respuesta (OE-11).
   */
  async discard(
    id: string,
    reason: string | undefined,
    discardedById: string,
  ): Promise<{ id: string; status: EscalationStatus }> {
    const { conversation } = await this.loadPending(id);

    await this.releaseConversation(conversation);

    const discarded = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: EscalationStatus.DISCARDED,
        discardedById,
        discardedAt: new Date(),
      },
    });

    await this.logger.logEvent({
      conversationId: conversation.id,
      eventType: 'escalation_discarded',
      payload: { discardedById, reason: reason ?? null },
    });

    return { id: discarded.id, status: discarded.status };
  }

  /**
   * Carga el caso exigiendo que siga abierto.
   *
   * Los tres cierres son terminales (FR-040): sin esto, dos supervisores
   * mirando la misma cola podrían cerrar el mismo caso y el usuario recibiría
   * dos respuestas por una sola consulta.
   */
  private async loadPending(id: string) {
    const escalation = await this.prisma.escalation.findUnique({
      where: { id },
    });
    if (!escalation) {
      throw new NotFoundException('Caso pendiente no encontrado');
    }
    if (escalation.status !== EscalationStatus.PENDING) {
      throw new ConflictException(
        `Este caso ya fue cerrado (${escalation.status})`,
      );
    }

    const conversation = await this.conversations.findById(
      escalation.conversationId,
    );
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }

    return { escalation, conversation };
  }

  /**
   * Devuelve la conversación al asistente, **salvo** que haya un supervisor
   * con el control tomado.
   *
   * `HUMAN_HANDLING` significa que alguien está escribiendo en ese chat ahora
   * mismo; volver a `ACTIVE` haría que el bot le conteste al usuario en el
   * medio de una conversación humana. Cerrar el caso escalado y soltar el chat
   * son dos decisiones distintas.
   */
  private async releaseConversation(conversation: {
    id: string;
    status: ConvStatus;
  }): Promise<void> {
    if (conversation.status === ConvStatus.HUMAN_HANDLING) return;
    await this.conversations.setStatus(conversation.id, 'ACTIVE');
  }

  /**
   * Derivar desde el chat de un responsable (spec 005, US4, FR-010).
   *
   * El caso todavía **no existe**: a un supervisor la baja confianza no le crea
   * ninguno —de eso se trata US2—, así que acá se crea recién cuando él decide que
   * el tema es de otra área y elige a quién pasárselo. Es `create()` + `delegate()`,
   * las dos piezas que ya estaban: lo nuevo es el momento en que se disparan, no el
   * mecanismo.
   *
   * La consulta que viaja como contexto sale de la **conversación**, no del cuerpo
   * del request: así el caso no puede llegar con un texto distinto del que
   * realmente se preguntó.
   */
  async delegateFromConversation(params: {
    conversationId: string;
    toEmployeeId: string;
    delegatedById: string;
  }) {
    const conversation = await this.conversations.findById(
      params.conversationId,
    );
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }

    // Derivarse el caso a sí mismo sería reproducir a mano exactamente el defecto
    // que esta spec vino a arreglar: un responsable con una consulta propia en su
    // propia cola.
    if (params.toEmployeeId === params.delegatedById) {
      throw new ConflictException(
        'No tiene sentido derivarte la consulta a vos mismo',
      );
    }

    const ultima = await this.conversations.getLastUserMessage(
      params.conversationId,
    );
    const consulta = ultima?.content ?? '(sin consulta registrada)';
    const tag = conversation.currentAgent
      ? `[${conversation.currentAgent}] `
      : '';

    const escalation = await this.create({
      conversationId: params.conversationId,
      reason: `${tag}Derivado por un responsable: «${consulta.slice(0, 100)}»`,
      agentType: conversation.currentAgent ?? undefined,
      internalNote:
        `Un responsable derivó esta consulta porque el tema no es de sus áreas.\n` +
        `Consulta: «${consulta}»`,
    });

    return this.delegate(
      escalation.id,
      { toEmployeeId: params.toEmployeeId },
      params.delegatedById,
    );
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
