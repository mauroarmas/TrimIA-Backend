import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { Channel, MessageRole, AgentType, Conversation } from '@prisma/client';

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
}