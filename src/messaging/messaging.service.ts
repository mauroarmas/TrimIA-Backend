import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Channel } from '@prisma/client';
import { ConversationsService } from '../conversations/conversations.service';
import { ClientsService } from '../clients/clients.service';
import { WhatsappMediaService } from './whatsapp-media.service';
import { PaymentProofsService } from '../collections/payment-proofs.service';
import { WebhookMessageDto } from './dto/webhook-message.dto';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @InjectQueue('message-processing')
    private readonly queue: Queue,
    private readonly conversations: ConversationsService,
    private readonly clients: ClientsService,
    private readonly media: WhatsappMediaService,
    private readonly paymentProofs: PaymentProofsService,
  ) { }

  private async prepareConversation(dto: WebhookMessageDto, channel: Channel) {
    // Si el teléfono corresponde a un cliente dado de alta, la conversación
    // queda vinculada a él (FK). Si todavía no existe, se resuelve en el
    // próximo mensaje — ver ConversationsService.getOrCreate().
    const client = await this.clients.getByPhone(dto.phone);
    const conversation = await this.conversations.getOrCreate(
      dto.phone,
      channel,
      client?.id,
    );
    const message = await this.conversations.addMessage(
      conversation.id,
      'USER',
      dto.message ?? '',
    );
    return { conversation, message };
  }

  async enqueue(dto: WebhookMessageDto): Promise<void> {
    const channel = dto.channel ?? Channel.WHATSAPP;
    const { conversation, message } = await this.prepareConversation(dto, channel);

    // Comprobante de pago (Sprint 4): NO pasa por el orquestador de IA — el
    // agente no debe "responder" un comprobante por su cuenta (Principio III,
    // humano en el loop). Se guarda, se crea el caso para el cobrador y listo.
    if (dto.mediaBase64 && dto.mimeType) {
      const imagePath = await this.media.savePaymentProofImage(
        dto.mediaBase64,
        dto.mimeType,
      );
      await this.paymentProofs.receiveFromWhatsapp({
        phone: dto.phone,
        messageId: message.id,
        imagePath,
      });
      return;
    }

    await this.queue.add(
      'process-message',
      {
        conversationId: conversation.id,
        externalId: dto.phone,
        channel,
        message: dto.message ?? '',
      },
      {
        // Reintentos ante fallos transitorios (Gemini/Chroma/red) con backoff.
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        // Higiene de Redis: no acumular jobs terminados indefinidamente.
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );
  }

}