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
  EscalationKnowledgeAction,
  KnowledgeChangeOrigin,
  KnowledgeSourceType,
  UserType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { KnowledgeAiEditService } from '../ai/knowledge/knowledge-ai-edit.service';
import { EmployeesService } from '../employees/employees.service';

/**
 * Cuántos documentos "que quedaron cortos" se le ofrecen al supervisor
 * (spec 007, FR-018).
 *
 * Con `k = 4` en la recuperación, cuatro son todos. El tope está igual porque
 * una lista larga es tan inútil como ninguna: si hay que elegir entre diez, ya
 * no es una oferta, es tarea.
 */
const MAX_CANDIDATOS = 4;

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
  /**
   * Spec 007 (US1): corregir un documento que quedó corto, en vez de crear uno
   * nuevo con `teachAgent`. Excluyente con él.
   */
  correctKnowledge?: {
    documentId: string;
    baseVersion: number;
    content: string;
  };
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
    // Spec 007: la propuesta de corrección se reusa tal cual de "editar con la
    // IA" — preview no persiste, apply guarda el texto que aprobó la persona.
    private readonly aiEdit: KnowledgeAiEditService,
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
      include: {
        conversation: true,
        // Spec 007: para poder mostrar "se corrigió «título»" / "ya existía
        // como «título»" sin que el panel tenga que pedir el documento aparte.
        resolvedWithDocument: { select: { id: true, title: true } },
      },
    });
    if (!escalation) {
      throw new NotFoundException('Caso pendiente no encontrado');
    }
    return escalation;
  }

  /**
   * Propuesta de cómo quedaría un documento si se le incorpora la respuesta
   * del supervisor (spec 007, US1 / FR-003, FR-004, FR-006).
   *
   * **No persiste absolutamente nada.** La aprobación ocurre después, en
   * `resolve` con `correctKnowledge` — que es lo que hace que "nunca se aplica
   * sin aprobación" (Principio III) sea imposible de violar por descuido en vez
   * de una regla que alguien tiene que acordarse de respetar. Es el mismo
   * diseño en dos pasos que ya usa "editar con la IA".
   */
  async correctionPreview(
    escalationId: string,
    input: { documentId: string; message: string },
    employeeId: string,
  ) {
    await this.findById(escalationId); // 404 si el caso no existe

    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: input.documentId },
      select: { id: true, agentType: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');

    // La autorización va ANTES de llamar al modelo, a propósito: gastar una
    // llamada a Gemini para proponer algo que después no se va a poder guardar
    // es trabajo tirado y una promesa falsa al supervisor.
    await this.knowledge.assertPuedeEscribir(employeeId, doc.agentType);

    // La instrucción sale de la respuesta que el supervisor ya escribió. Se
    // reusa `aiEdit.preview` tal cual: si hubiera que modificarlo para esto, la
    // reutilización sería aparente y no real.
    return this.aiEdit.preview(
      input.documentId,
      `Incorporá esta información al documento, que quedó incompleto y por eso ` +
        `una consulta terminó derivándose a una persona:\n\n${input.message}`,
    );
  }

  /**
   * Los documentos que se consultaron en este caso y **no alcanzaron**
   * (spec 007, US1 / FR-001, FR-002, FR-006).
   *
   * De acá sale la oferta que cierra la contradicción del producto: el aviso de
   * baja confianza ya le dice al supervisor que *"lo que conviene es corregir
   * ese documento, no cargar otro"* (`low-confidence.node.ts`), y hasta ahora el
   * único botón disponible creaba uno nuevo que competía con él.
   *
   * **Una lista vacía es una respuesta legítima y frecuente**: el caso escaló
   * sin recuperar nada. No es un error — es el escenario donde no hay nada que
   * corregir y corresponde crear un documento nuevo, como siempre.
   */
  async knowledgeCandidates(escalationId: string, employeeId: string) {
    await this.findById(escalationId); // 404 si no existe

    const retrievals = await this.prisma.knowledgeRetrieval.findMany({
      where: {
        escalationId,
        // Ofrecer corregir algo que ya no responde confunde más de lo que
        // ayuda (FR-019).
        document: { isActive: true },
      },
      select: {
        score: true,
        rank: true,
        document: { select: { id: true, title: true, agentType: true } },
      },
      orderBy: { rank: 'asc' },
    });

    // `retrievals` trae FRAGMENTOS: un documento largo puede haber ocupado
    // varios lugares del top-k. Se queda el mejor de cada uno — mismo criterio
    // que `mejoresPorDocumento` en low-confidence.node.ts, y por el mismo
    // motivo: repetir el título con scores distintos hace pensar que hay
    // duplicados cargados y manda a "arreglar" algo que no está roto.
    const mejorPorDocumento = new Map<string, (typeof retrievals)[number]>();
    for (const r of retrievals) {
      const previo = mejorPorDocumento.get(r.document.id);
      if (!previo || r.rank < previo.rank) {
        mejorPorDocumento.set(r.document.id, r);
      }
    }

    const candidatos = [...mejorPorDocumento.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATOS);

    // La autorización se consulta, no se replica: `assertPuedeEscribir` es el
    // punto único de la spec 005. Acá se captura su excepción en vez de dejarla
    // propagar porque **el documento igual se muestra**: ver lo ajeno es lo que
    // evita duplicarlo ("ver no es editar"). Lo que se bloquea es corregirlo.
    return Promise.all(
      candidatos.map(async (c) => {
        let corregible = true;
        let motivoSiNo: string | undefined;
        try {
          await this.knowledge.assertPuedeEscribir(
            employeeId,
            c.document.agentType,
          );
        } catch (err) {
          corregible = false;
          // El motivo viaja: un botón deshabilitado sin explicación es un
          // misterio, y el mensaje de assertPuedeEscribir ya dice de qué áreas
          // sí es responsable.
          motivoSiNo = err instanceof Error ? err.message : 'No autorizado';
        }
        return {
          id: c.document.id,
          title: c.document.title,
          agentType: c.document.agentType,
          score: c.score,
          corregible,
          motivoSiNo,
        };
      }),
    );
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

    // Spec 007: corregir un documento existente es escribir igual que crear uno,
    // así que pasa por la misma regla y por el mismo motivo — antes de enviar
    // nada, para que un rechazo deje el caso intacto.
    //
    // Ojo: el área que manda es la DEL DOCUMENTO, no la de la conversación. Un
    // caso de Ventas puede haber recuperado un documento de Cobranzas, y quien
    // decide si se puede tocar es el área de lo que se está por modificar.
    if (input.correctKnowledge) {
      if (input.teachAgent) {
        throw new ConflictException(
          'No se puede crear un documento nuevo y corregir uno existente en la ' +
            'misma resolución: o se mejora lo que hay, o se agrega algo nuevo.',
        );
      }
      const doc = await this.prisma.knowledgeDocument.findUnique({
        where: { id: input.correctKnowledge.documentId },
        select: { agentType: true },
      });
      if (!doc) throw new NotFoundException('Documento no encontrado');
      await this.knowledge.assertPuedeEscribir(resolvedById, doc.agentType);
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

    // Spec 007: la corrección va ANTES de cerrar el caso para poder anotar en el
    // mismo update con qué documento se resolvió. Si falla, el caso igual se
    // cierra — el mensaje ya se envió y reintentar se lo mandaría dos veces al
    // usuario (el mismo aprendizaje que dejó la spec 006 con `teachAgent`).
    let corregido: string | null = null;
    if (input.correctKnowledge) {
      try {
        await this.knowledge.update(
          input.correctKnowledge.documentId,
          {
            content: input.correctKnowledge.content,
            origin: KnowledgeChangeOrigin.AI_ACCEPTED,
            // La versión base viaja para que un cambio ajeno hecho mientras
            // tanto no se pise en silencio: `update()` ya devuelve 409.
            expectedVersion: input.correctKnowledge.baseVersion,
            // FR-009: de qué caso salió esta edición, para que se sepa leyendo
            // la bitácora del documento y no haya que adivinar por fecha.
            escalationId: id,
          },
          resolvedById,
        );
        corregido = input.correctKnowledge.documentId;
      } catch (err) {
        // Como evento y no como línea de log: el `escalation_resolved` de abajo
        // dice cómo se cerró el caso, y sin esto estaría mintiendo. El
        // supervisor tiene que poder enterarse de que su corrección no entró
        // (OE-11).
        await this.logger.logEvent({
          conversationId: conversation.id,
          eventType: 'escalation_correction_failed',
          payload: {
            escalationId: id,
            documentId: input.correctKnowledge.documentId,
            resolvedById,
            motivo: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    const resolved = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: EscalationStatus.RESOLVED,
        resolvedById,
        resolution: input.message,
        resolvedAt: new Date(),
        // Solo si la corrección entró de verdad: marcarlo igual dejaría el caso
        // diciendo que se corrigió un documento que quedó intacto.
        ...(corregido
          ? {
              resolvedWithAction: EscalationKnowledgeAction.CORRECTED,
              resolvedWithDocumentId: corregido,
            }
          : {}),
      },
    });

    await this.logger.logEvent({
      conversationId: conversation.id,
      eventType: 'escalation_resolved',
      payload: {
        resolvedById,
        teachAgent: !!input.teachAgent,
        corregido: corregido ?? undefined,
      },
    });

    if (input.teachAgent) {
      // Antes se inferÍa PUBLICO cuando la conversación era con un CLIENTE.
      // Eso publicaba automáticamente lo que el supervisor tipeó para ESE
      // caso puntual — sin que lo decidiera a propósito — como conocimiento
      // servido a cualquier cliente futuro. Default seguro: INTERNO, igual
      // que knowledge.ingest() (knowledge.service.ts). Publicarlo requiere
      // que el supervisor mande audience: PUBLICO explícito.
      const audience = input.audience ?? Audience.INTERNO;
      // ⚠️ A esta altura el mensaje YA se le envió al usuario, la conversación
      // ya se liberó y el caso ya quedó RESOLVED. Dejar que un fallo de la
      // ingesta tumbe el endpoint le mostraría un error al supervisor por una
      // operación que en lo esencial salió bien — y si reintenta, el usuario
      // recibe el mensaje dos veces.
      //
      // Desde la spec 006 `ingest()` lanza cuando la vectorización falla (antes
      // se tragaba los vectores vacíos y devolvía como si nada). El documento
      // queda en REINDEX_FAILED, visible en el panel y con su botón de
      // reintentar, así que el conocimiento no se pierde: solo llega tarde.
      try {
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
      } catch (err) {
        // Spec 007, FR-023: un duplicado EXACTO no es un fallo — es el caso que
        // esta spec vino a resolver. `ingest()` ya lo detectó y no creó nada
        // (FR-013): acá solo queda dejar constancia de CON QUÉ documento se
        // resolvió, ya que ese dato se conoce recién ahora, después de que el
        // caso quedó RESOLVED.
        if (
          err instanceof ConflictException &&
          (err.getResponse() as Record<string, unknown>).reason ===
            'DUPLICATE_DOCUMENT'
        ) {
          const { existing } = err.getResponse() as {
            existing: { id: string; title: string };
          };
          await this.prisma.escalation.update({
            where: { id },
            data: {
              resolvedWithAction: EscalationKnowledgeAction.REUSED,
              resolvedWithDocumentId: existing.id,
            },
          });
        } else {
          // Cualquier OTRO fallo (Chroma caído, vectorización) queda como
          // evento, no como línea de log: el `escalation_resolved` de más
          // arriba dice `teachAgent: true` y sin esto estaría mintiendo. El
          // supervisor tiene que poder enterarse de que su enseñanza no llegó
          // (OE-11).
          await this.logger.logEvent({
            conversationId: conversation.id,
            eventType: 'escalation_teach_failed',
            payload: {
              escalationId: id,
              resolvedById,
              motivo: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
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

    // Spec 007, FR-021/FR-023: acá la ingesta ES el efecto, todavía no se envió
    // ni se liberó nada — a diferencia de `resolve`, un fallo REAL puede
    // seguir propagándose sin problema. Lo único que cambia es que un
    // duplicado EXACTO no es un fallo: se reusa el documento que ya existía en
    // vez de crear otro, y la operación sigue su curso normal.
    let documentId: string;
    let reusedExisting = false;
    try {
      ({ documentId } = await this.knowledge.ingest({
        title: input.title,
        content: input.message,
        category: input.category,
        audience,
        agentType: areaDelDocumento,
        sourceType: KnowledgeSourceType.ESCALADO,
        sourceId: escalation.id,
      }));
    } catch (err) {
      if (
        err instanceof ConflictException &&
        (err.getResponse() as Record<string, unknown>).reason ===
          'DUPLICATE_DOCUMENT'
      ) {
        documentId = (err.getResponse() as { existing: { id: string } })
          .existing.id;
        reusedExisting = true;
      } else {
        throw err;
      }
    }

    await this.releaseConversation(conversation);

    const saved = await this.prisma.escalation.update({
      where: { id },
      data: {
        status: EscalationStatus.SAVED_UNSENT,
        savedResponse: input.message,
        resolvedById: savedById,
        resolvedAt: new Date(),
        ...(reusedExisting
          ? {
              resolvedWithAction: EscalationKnowledgeAction.REUSED,
              resolvedWithDocumentId: documentId,
            }
          : {}),
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
