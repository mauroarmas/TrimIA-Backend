import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Channel } from '@prisma/client';
import { ConversationsService } from '../../conversations/conversations.service';
import { WhatsappSenderService } from '../../messaging/whatsapp-sender.service';
import { OrchestratorService } from '../../ai/orchestrator/orchestrator.service';

interface MessageJob {
  threadId: string;
  conversationId: string;
  externalId: string;
  channel: Channel;
  message: string;
}

@Processor('message-processing', { concurrency: 1 })
export class MessageProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly sender: WhatsappSenderService,
    private readonly orchestrator: OrchestratorService,
  ) {
    super();
  }

  async process(job: Job<MessageJob>): Promise<void> {
    const { conversationId, externalId, message, threadId, channel } = job.data;

    this.logger.log(`Processing message [threadId=${threadId}]: "${message}"`);

    // El orquestador clasifica, deriva al agente y registra eventos/tokens.
    const result = await this.orchestrator.invoke(
      threadId,
      message,
      conversationId,
    );
    const response =
      result.response ?? 'Disculpá, no pude procesar tu mensaje en este momento.';

    await this.conversations.addMessage(
      conversationId,
      'ASSISTANT',
      response,
      result.agentType ?? undefined,
    );
    await this.sender.send(externalId, response, channel);

    this.logger.log(`Response sent to ${externalId}`);
  }
}