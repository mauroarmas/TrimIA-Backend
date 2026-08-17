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

    const { documentId } = await this.knowledge.ingest({
      title: input.title,
      content: input.message,
      category: input.category,
      audience,
      agentType: input.agentType ?? conversation.currentAgent,
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
