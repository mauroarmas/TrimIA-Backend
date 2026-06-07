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

  private static readonly FALLBACK =
    'Disculpá, tuve un problema para procesar tu mensaje. Por favor, intentá de nuevo en unos minutos. 🙏';

  async process(job: Job<MessageJob>): Promise<void> {
    const { conversationId, externalId, message, threadId, channel } = job.data;

    this.logger.log(`Processing message [threadId=${threadId}]: "${message}"`);

    try {
      // Sticky + historial: una sola query trae todo lo que necesita el orquestador.
      const conversation = await this.conversations.findById(conversationId);
      const currentAgent = conversation?.currentAgent ?? null;
      const userType = conversation?.userType ?? null;
      const history = await this.conversations.getRecentHistory(conversationId);

      // El orquestador clasifica (o saltea, si hay sticky), deriva y registra.
      const result = await this.orchestrator.invoke(
        threadId,
        message,
        conversationId,
        currentAgent,
        userType,
        history,
      );
      const response = result.response ?? MessageProcessor.FALLBACK;

      // Si se resolvió un agente, queda fijado como sticky de la conversación.
      // (saludos triviales y greeting no tienen agentType → no lo modifican.)
      if (result.agentType) {
        await this.conversations.setCurrentAgent(
          conversationId,
          result.agentType,
        );
      }

      await this.conversations.addMessage(
        conversationId,
        'ASSISTANT',
        response,
        result.agentType ?? undefined,
      );
      await this.sender.send(externalId, response, channel);

      this.logger.log(`Response sent to ${externalId}`);
    } catch (err) {
      // Cualquier fallo (Gemini, Chroma, DB) no debe dejar al usuario sin
      // respuesta. Logueamos y relanzamos para que BullMQ reintente; solo
      // avisamos al usuario en el ÚLTIMO intento, para no duplicar mensajes.
      this.logger.error(
        `Error procesando mensaje [threadId=${threadId}]: ${
          err instanceof Error ? err.message : err
        }`,
      );
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.sender
          .send(externalId, MessageProcessor.FALLBACK, channel)
          .catch((sendErr) =>
            this.logger.error(`No se pudo avisar al usuario: ${sendErr}`),
          );
      }
      throw err;
    }
  }
}