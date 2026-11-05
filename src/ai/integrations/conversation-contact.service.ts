import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** Teléfono y vínculo tomados del hilo persistido, jamás de argumentos del modelo. */
@Injectable()
export class ConversationContactService {
  constructor(private readonly prisma: PrismaService) {}
  async getContact(conversationId: string | null) {
    if (!conversationId) return null;
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, externalId: true, channel: true },
    });
    if (
      !conversation ||
      conversation.channel !== 'WHATSAPP' ||
      !/^\+?\d{8,15}$/.test(conversation.externalId)
    )
      return null;
    return { phone: conversation.externalId, conversationId: conversation.id };
  }
}
