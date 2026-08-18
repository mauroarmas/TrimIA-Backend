import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  Channel,
  MessageRole,
  AgentType,
  Conversation,
  ConvStatus,
} from '@prisma/client';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';

export interface ConversationTurn {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsappSenderService,
    private readonly orchestrationLogger: OrchestrationLogger,
  ) {}

  /**
   * Conversación abierta del contacto, o una nueva.
   *
   * `clientId` vincula la conversación con el Cliente ya dado de alta. Es
   * opcional porque un desconocido puede escribir antes de existir en la DB;
   * si se da de alta después, la FK se retro-completa en el siguiente mensaje
   * en vez de quedar huérfana para siempre. Nunca se desasigna: si la
   * conversación ya tiene cliente, gana el que está.
   */
  async getOrCreate(
    externalId: string,
    channel: Channel,
    clientId?: string | null,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { externalId, channel, status: { not: 'CLOSED' } },
    });
    if (existing) {
      if (clientId && !existing.clientId) {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { clientId },
        });
      }
      return existing;
    }

    return this.prisma.conversation.create({
      data: { externalId, channel, clientId: clientId ?? undefined },
    });
  }

  async addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    agentType?: AgentType,
  ) {
    return this.prisma.message.create({
      data: { conversationId, role, content, agentType },
    });
  }

  /** Devuelve la conversación por id (para leer el currentAgent sticky). */
  findById(conversationId: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
  }

  /**
   * Devuelve los últimos `limit` turnos USER/ASSISTANT de la conversación,
   * ordenados del más antiguo al más reciente (orden natural para el LLM).
   * Se excluyen roles SYSTEM y TOOL para no filtrar internos al modelo.
   *
   * `excludeMessageId` saca el mensaje que se está procesando ahora. Hace
   * falta porque el mensaje del cliente se persiste ANTES de encolar el job,
   * así que sin esto el agente lo recibía dos veces: una en el historial y
   * otra en el HumanMessage de la consulta. Se excluye por id y no "el
   * último USER" porque si el cliente manda dos mensajes seguidos hay dos
   * jobs en vuelo y cada uno tiene que sacar el suyo, no el más nuevo.
   */
  async getRecentHistory(
    conversationId: string,
    limit = 6,
    excludeMessageId?: string,
  ): Promise<ConversationTurn[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: { in: ['USER', 'ASSISTANT'] },
        ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, content: true },
    });
    // Invertir para presentar al LLM en orden cronológico.
    return rows.reverse() as ConversationTurn[];
  }

  /**
   * Último mensaje del asistente en la conversación. Se usa para no repetir
   * un aviso automático que ya se mandó (ver el acuse de WAITING_HUMAN en
   * MessageProcessor).
   */
  async getLastAssistantMessage(conversationId: string) {
    return this.prisma.message.findFirst({
      where: { conversationId, role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
  }

  /** Fija el agente sticky de la conversación tras resolver un mensaje. */
  async setCurrentAgent(conversationId: string, agent: AgentType) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { currentAgent: agent, agentLockedAt: new Date() },
    });
  }

  /** Actualiza el userType de la conversación (al detectar empleado por whitelist). */
  async setUserType(conversationId: string, userType: 'CLIENTE' | 'EMPLEADO') {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { userType },
    });
  }

  /**
   * Cambia el status de la conversación (Sprint 3 — human-in-the-loop).
   * Usado por EscalationsService (ACTIVE ↔ WAITING_HUMAN) y por
   * takeover()/release() (ACTIVE ↔ HUMAN_HANDLING) de este mismo servicio.
   */
  async setStatus(conversationId: string, status: ConvStatus) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status },
    });
  }

  /**
   * Un supervisor toma el control manual de la conversación (Sprint 3).
   * Funciona sobre ACTIVE o WAITING_HUMAN; rechaza CLOSED y rechaza si ya
   * la tiene tomada OTRO supervisor (FR-005, FR-009).
   */
  async takeover(conversationId: string, employeeId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (conversation.status === 'CLOSED') {
      throw new ConflictException('La conversación ya está cerrada');
    }
    if (
      conversation.status === 'HUMAN_HANDLING' &&
      conversation.handledById !== employeeId
    ) {
      throw new ConflictException(
        'Otro supervisor ya tiene el control de esta conversación',
      );
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'HUMAN_HANDLING',
        handledById: employeeId,
        handledAt: new Date(),
      },
    });

    await this.orchestrationLogger.logEvent({
      conversationId,
      eventType: 'conversation_takeover',
      payload: { employeeId },
    });

    return updated;
  }

  /**
   * Devuelve el control manual al agente de IA (FR-008). Solo puede
   * liberarla quien figura en `handledById` (evita que un tercero corte la
   * intervención de otro supervisor) — salvo que quien la libera sea
   * `SUPERVISOR` (`asSupervisor=true`), que puede destrabar cualquier caso.
   *
   * Ese bypass hace falta porque `takeover()` se puede disparar desde dos
   * lugares con distinto nivel de acceso: este mismo endpoint (SUPERVISOR) y
   * `PaymentProofsService.markManualHandling()` ("voy a manejarlo yo", Sprint
   * 4), que no exige rol SUPERVISOR — cualquier EMPLEADO puede tomar una
   * conversación por esa vía. Sin el bypass, ese EMPLEADO queda sin ninguna
   * salida legítima para liberarla (el endpoint de liberación es
   * SUPERVISOR-only, y un supervisor distinto era rechazado por no coincidir
   * el `handledById`) — quedaba en HUMAN_HANDLING para siempre.
   */
  async release(
    conversationId: string,
    employeeId: string,
    asSupervisor = false,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (conversation.status !== 'HUMAN_HANDLING') {
      throw new ConflictException('La conversación no está en control manual');
    }
    if (!asSupervisor && conversation.handledById !== employeeId) {
      throw new ForbiddenException('No tenés el control de esta conversación');
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'ACTIVE', handledById: null, handledAt: null },
    });

    await this.orchestrationLogger.logEvent({
      conversationId,
      eventType: 'conversation_release',
      payload: { employeeId },
    });

    return updated;
  }

  /**
   * Envía un mensaje manual al usuario mientras dura el control (FR-007).
   * Solo lo puede hacer quien tiene la conversación tomada.
   */
  async replyManually(
    conversationId: string,
    employeeId: string,
    message: string,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (
      conversation.status !== 'HUMAN_HANDLING' ||
      conversation.handledById !== employeeId
    ) {
      throw new ForbiddenException('No tenés el control de esta conversación');
    }

    await this.sender.send(
      conversation.externalId,
      message,
      conversation.channel,
    );

    return this.prisma.message.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: message,
        agentType: conversation.currentAgent ?? undefined,
      },
    });
  }

  /**
   * Nota interna sobre una conversación (FR-012). Nunca genera un Message ni
   * se envía al usuario — es visible solo para quien tiene acceso al panel.
   */
  async addInternalNote(
    conversationId: string,
    authorId: string,
    content: string,
  ) {
    const note = await this.prisma.internalNote.create({
      data: { conversationId, authorId, content },
    });

    await this.orchestrationLogger.logEvent({
      conversationId,
      eventType: 'internal_note_added',
      payload: { authorId },
    });

    return note;
  }

  /**
   * Nota interna escrita por un AGENTE de IA, no por una persona.
   *
   * La usa el agente al escalar, para dejarle al supervisor un resumen del
   * caso y que no tenga que reconstruirlo leyendo toda la conversación.
   * Va en la misma tabla que las notas humanas (aparecen juntas en el
   * timeline del panel), distinguidas por `authorAgentType` — por eso
   * `InternalNote.authorId` es opcional en el schema.
   */
  async addAgentNote(
    conversationId: string,
    agentType: AgentType | null,
    content: string,
  ) {
    const note = await this.prisma.internalNote.create({
      data: { conversationId, authorAgentType: agentType, content },
    });

    await this.orchestrationLogger.logEvent({
      conversationId,
      eventType: 'internal_note_added',
      agentType,
      payload: { authorAgentType: agentType },
    });

    return note;
  }

  async listInternalNotes(conversationId: string) {
    return this.prisma.internalNote.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Historial paginado de una conversación, orden cronológico ascendente —
   * así se lee un chat (US4, FR-015). Igual que `getRecentHistory()`, solo
   * expone `USER`/`ASSISTANT`: `SYSTEM` y `TOOL` no son para el usuario.
   */
  async listMessages(
    conversationId: string,
    opts: { page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const skip = (page - 1) * limit;
    const where = {
      conversationId,
      role: { in: ['USER' as const, 'ASSISTANT' as const] },
    };

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          role: true,
          content: true,
          agentType: true,
          createdAt: true,
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { data, page, limit, total, hasMore: skip + data.length < total };
  }

  /**
   * Vista unificada de lectura (US4, FR-018): todos los mensajes de un mismo
   * contacto, en los dos canales, en una sola línea de tiempo — sin fusionar
   * los hilos ni compartir memoria entre ellos.
   *
   * Sale de una sola consulta por `externalId` sin filtrar canal, porque el
   * chat web usa el mismo `externalId` que WhatsApp (el teléfono del
   * empleado, research §8): no hace falta ninguna tabla de correlación.
   *
   * Devuelve `null` cuando el contacto no tiene ninguna conversación — el
   * llamador decide si eso es 404 o una lista vacía.
   */
  async getUnifiedTimeline(externalId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { externalId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, channel: true, status: true, currentAgent: true },
    });
    if (conversations.length === 0) return null;

    const channelById = new Map(conversations.map((c) => [c.id, c.channel]));
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        role: { in: ['USER', 'ASSISTANT'] },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        conversationId: true,
        role: true,
        content: true,
        agentType: true,
        createdAt: true,
      },
    });

    return {
      conversations,
      // Cada entrada lleva su `channel` y `conversationId`: es lo que evita
      // que dos hilos con agentes distintos, intercalados en el tiempo, se
      // lean como una sola conversación que nunca existió.
      timeline: messages.map((m) => ({
        ...m,
        channel: channelById.get(m.conversationId)!,
      })),
    };
  }
}
