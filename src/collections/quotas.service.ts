import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';

/**
 * Gestión de cuotas (Sprint 4 — Historia 5: marcar como manejadas manualmente).
 */
@Injectable()
export class QuotasService {
  private readonly logger = new Logger(QuotasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrationLogger: OrchestrationLogger,
    private readonly conversations: ConversationsService,
    private readonly sender: WhatsappSenderService,
  ) {}

  async markManual(
    quotaId: string,
    employeeId: string,
    isController: boolean,
    note?: string,
  ) {
    const quota = await this.prisma.quota.findUnique({
      where: { id: quotaId },
      include: { client: true },
    });

    if (!quota) {
      throw new NotFoundException('Cuota no encontrada');
    }

    if (!isController && quota.client.assignedCollectorId !== employeeId) {
      throw new ForbiddenException('No tenés acceso a esta cuota');
    }

    const updated = await this.prisma.quota.update({
      where: { id: quotaId },
      data: {
        status: 'MANUAL',
        manualHandlingNote: note,
      },
    });

    await this.orchestrationLogger.logEvent({
      eventType: 'quota_marked_manual',
      payload: {
        quotaId,
        markedByEmployeeId: employeeId,
        note,
      },
    });

    this.logger.log(
      `Cuota ${quotaId} marcada como manejada manualmente por ${employeeId}`,
    );

    return updated;
  }

  /**
   * "Solicitar comprobante" (prototipo, Fig 3): el cliente avisó por
   * WhatsApp que ya pagó pero no envió el comprobante. El cobrador dispara
   * este mensaje a mano en vez de esperar el próximo ciclo de recordatorios
   * automáticos, que corre una vez al día y está pensado para cuotas
   * PENDING/OVERDUE, no para este caso puntual.
   *
   * No se persiste como columna nueva: queda como OrchestrationEvent
   * (`proof_requested`), que ya alimenta el Registro de Actividad — evita
   * una migración para un dato que es, en esencia, un evento del historial.
   */
  async requestProof(
    quotaId: string,
    employeeId: string,
    isController: boolean,
  ) {
    const quota = await this.prisma.quota.findUnique({
      where: { id: quotaId },
      include: { client: true },
    });

    if (!quota) {
      throw new NotFoundException('Cuota no encontrada');
    }

    if (!isController && quota.client.assignedCollectorId !== employeeId) {
      throw new ForbiddenException('No tenés acceso a esta cuota');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { clientId: quota.clientId, status: { not: 'CLOSED' } },
    });

    const message =
      `Hola ${quota.client.name}! Para poder confirmar tu pago de $${quota.amount}, ` +
      `¿podrías enviarnos el comprobante de la transferencia por este mismo chat? 🙏`;

    await this.sender.send(quota.client.phone, message, 'WHATSAPP');

    if (conversation) {
      await this.conversations.addMessage(
        conversation.id,
        'ASSISTANT',
        message,
      );
    }

    await this.orchestrationLogger.logEvent({
      conversationId: conversation?.id ?? null,
      eventType: 'proof_requested',
      payload: { quotaId, requestedById: employeeId },
    });

    this.logger.log(
      `Comprobante solicitado a ${quota.client.name} (cuota ${quotaId})`,
    );

    return { requested: true };
  }
}
