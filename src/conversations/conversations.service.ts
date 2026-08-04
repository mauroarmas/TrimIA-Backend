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

  async getOrCreate(externalId: string, channel: Channel): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { externalId, channel, status: { not: 'CLOSED' } },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { externalId, channel },
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
   */
  async getRecentHistory(
    conversationId: string,
    limit = 6,
  ): Promise<ConversationTurn[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: { in: ['USER', 'ASSISTANT'] },
        // Excluir el mensaje actual (el último USER todavía no tiene respuesta)
        // — el processor lo agrega después de invocar el orquestador.
        // Solo traemos los turnos previos completos (pares USER+ASSISTANT).
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, content: true },
    });
    // Invertir para presentar al LLM en orden cronológico.
    return rows.reverse() as ConversationTurn[];
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
   * intervención de otro supervisor).
   */
  async release(conversationId: string, employeeId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (conversation.status !== 'HUMAN_HANDLING') {
      throw new ConflictException(
        'La conversación no está en control manual',
      );
    }
    if (conversation.handledById !== employeeId) {
      throw new ForbiddenException(
        'No tenés el control de esta conversación',
      );
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
  async replyManually(conversationId: string, employeeId: string, message: string) {
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
      throw new ForbiddenException(
        'No tenés el control de esta conversación',
      );
    }

    await this.sender.send(conversation.externalId, message, conversation.channel);

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
  async addInternalNote(conversationId: string, authorId: string, content: string) {
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

  async listInternalNotes(conversationId: string) {
    return this.prisma.internalNote.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}