import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Channel } from '@prisma/client';
import { ConversationsService } from '../conversations/conversations.service';
import { ClientsService } from '../clients/clients.service';
import { WhatsappMediaService } from './whatsapp-media.service';
import { PaymentProofsService } from '../collections/payment-proofs.service';
import { EmployeesService } from '../employees/employees.service';
import { WebhookMessageDto } from './dto/webhook-message.dto';
import { normalizePhone } from '../common/phone';
import { messageForStorage } from '../ai/orchestrator/utils/trivial-filter';

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
    private readonly employees: EmployeesService,
  ) {}

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
      // Lo que se GUARDA puede diferir de lo que se PROCESA: el marcador de
      // audio no transcribible se persiste como un texto legible, mientras
      // que el job sigue llevando el marcador crudo para que el orquestador
      // lo detecte. Sin esto, el centinela terminaba en el panel del
      // supervisor y —peor— en el historial que se le pasa al LLM.
      messageForStorage(dto.message ?? ''),
    );
    return { conversation, message };
  }

  async enqueue(dto: WebhookMessageDto): Promise<void> {
    const channel = dto.channel ?? Channel.WHATSAPP;
    const { conversation, message } = await this.prepareConversation(
      dto,
      channel,
    );

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
        // Para que el processor lo saque del historial: ya está persistido.
        messageId: message.id,
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

  /**
   * Mensaje desde el chat web del panel (US4, research §8).
   *
   * La conversación se identifica por el **teléfono normalizado del
   * empleado**, no por su id: es lo que hace que la vista unificada
   * (`ConversationsService.getUnifiedTimeline`) salga de una sola consulta
   * por `externalId` sin tabla de correlación, y lo que hace que
   * `MessageProcessor` derive el `userType` sin ningún cambio — ya busca el
   * empleado por teléfono en cada mensaje.
   */
  async enqueueWeb(
    employeeId: string,
    message: string,
  ): Promise<{ conversationId: string }> {
    const employee = await this.employees.findById(employeeId);
    if (!employee.phone) {
      // 409, no 400: el dato falta del lado del empleado (algo que un
      // supervisor tiene que cargar), no es un error de lo que mandó el
      // request.
      throw new ConflictException(
        'No tenés un teléfono cargado en tu perfil, así que no se puede ' +
          'identificar tu conversación con el asistente. Pedile a un ' +
          'supervisor que te lo cargue.',
      );
    }
    const phone = normalizePhone(employee.phone);

    const { conversation, message: persisted } = await this.prepareConversation(
      { phone, message } as WebhookMessageDto,
      Channel.WEB,
    );

    await this.queue.add(
      'process-message',
      {
        conversationId: conversation.id,
        externalId: phone,
        channel: Channel.WEB,
        message,
        messageId: persisted.id,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );

    return { conversationId: conversation.id };
  }
}
