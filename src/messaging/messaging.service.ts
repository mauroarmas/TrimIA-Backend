import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Channel } from '@prisma/client';
import { ConversationsService } from '../conversations/conversations.service';
import { WebhookMessageDto } from './dto/webhook-message.dto';

@Injectable()
export class MessagingService {
  constructor(
    @InjectQueue('message-processing')
    private readonly queue: Queue,
    private readonly conversations: ConversationsService,
  ) { }

  private async prepareConversation(dto: WebhookMessageDto, channel: Channel) {
    const conversation = await this.conversations.getOrCreate(dto.phone, channel);
    await this.conversations.addMessage(conversation.id, 'USER', dto.message);
    return conversation;
  }

  async enqueue(dto: WebhookMessageDto): Promise<void> {
    const channel = dto.channel ?? Channel.WHATSAPP;
    const conversation = await this.prepareConversation(dto, channel);

    await this.queue.add('process-message', {
      threadId: conversation.threadId,
      conversationId: conversation.id,
      externalId: dto.phone,
      channel,
      message: dto.message,
    });
  }

}