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
  ) {}

  async enqueue(dto: WebhookMessageDto): Promise<void> {
    const conversation = await this.conversations.getOrCreate(
      dto.phone,
      Channel.WHATSAPP,
    );

    await this.conversations.addMessage(
      conversation.id,
      'USER',
      dto.message,
    );

    await this.queue.add('process-message', {
      threadId: conversation.threadId,
      conversationId: conversation.id,
      externalId: dto.phone,
      channel: Channel.WHATSAPP,
      message: dto.message,
    });

    
    //await this.queue.add('process-message', { threadId, ... });
    //          │        │                   │
    //          │        │                   └── el contenido del job (data)
    //          │        └────────────────────── el name (etiqueta)
    //          └─────────────────────────────── la queue (donde se mete el job)
    //
    // Lo que devuelve queue.add() es el JOB recién creado.
  }
}