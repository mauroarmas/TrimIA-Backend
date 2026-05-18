import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConversationsService } from '../../conversations/conversations.service';
import { WhatsappSenderService } from '../../messaging/whatsapp-sender.service';

interface MessageJob {
  threadId: string;
  conversationId: string;
  externalId: string;
  message: string;
}

@Processor('message-processing', { concurrency: 1 })
export class MessageProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly sender: WhatsappSenderService,
  ) {
    super();
  }

  async process(job: Job<MessageJob>): Promise<void> {
    const { conversationId, externalId, message, threadId } = job.data;

    this.logger.log(`Processing message [threadId=${threadId}]: "${message}"`);

    // Fase 2 — stub: respuesta hardcodeada
    // Fase 3: reemplazar por llamada al OrchestratorService
    const response = `Hola! Recibí tu mensaje. En breve te atiendo. [stub]`;

    await this.conversations.addMessage(conversationId, 'ASSISTANT', response);
    await this.sender.send(externalId, response);

    this.logger.log(`Response sent to ${externalId}`);
  }
}