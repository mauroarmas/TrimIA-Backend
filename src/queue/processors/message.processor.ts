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

    // Sticky: recuperamos el agente que venía atendiendo la conversación.
    const conversation = await this.conversations.findById(conversationId);
    const currentAgent = conversation?.currentAgent ?? null;

    // El orquestador clasifica (o saltea, si hay sticky), deriva y registra.
    const result = await this.orchestrator.invoke(
      threadId,
      message,
      conversationId,
      currentAgent,
    );
    const response =
      result.response ?? 'Disculpá, no pude procesar tu mensaje en este momento.';

    // Si se resolvió un agente, queda fijado como sticky de la conversación.
    // (saludos triviales y greeting no tienen agentType → no lo modifican.)
    if (result.agentType) {
      await this.conversations.setCurrentAgent(conversationId, result.agentType);
    }

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