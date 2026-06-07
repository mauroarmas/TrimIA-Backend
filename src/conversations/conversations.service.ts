import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { Channel, MessageRole, AgentType, Conversation } from '@prisma/client';

export interface ConversationTurn {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(externalId: string, channel: Channel): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { externalId, channel, status: { not: 'CLOSED' } },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { threadId: uuidv4(), externalId, channel },
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
}