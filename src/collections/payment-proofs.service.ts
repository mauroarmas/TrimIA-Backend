import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ProofRejectionReason } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ClientsService } from '../clients/clients.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';

const REJECTION_MESSAGES: Record<ProofRejectionReason, string> = {
  PAST_DATE:
    'Vimos que el comprobante que enviaste corresponde a una fecha anterior. ¿Podrías enviarnos el comprobante del pago actual? 🙏',
  WRONG_CBU:
    'El comprobante que enviaste no corresponde a la cuenta de la empresa. Por favor revisá el CBU de destino y enviá el comprobante correcto.',
  AMOUNT_TOO_LOW:
    'El monto transferido es menor al que corresponde para esta cuota. ¿Podrías completar la diferencia y enviarnos el comprobante actualizado?',
};

const ACCEPTED_MESSAGE = '¡Recibido, gracias! 🙌';

const proofInclude = {
  message: true,
  quota: { include: { client: true } },
} as const;

@Injectable()
export class PaymentProofsService {
  private readonly logger = new Logger(PaymentProofsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly clients: ClientsService,
    private readonly sender: WhatsappSenderService,
    private readonly orchestrationLogger: OrchestrationLogger,
    @InjectQueue('receipt-extraction')
    private readonly receiptQueue: Queue,
  ) {}

  /**
   * Crea el caso pendiente de revisión cuando llega una imagen por WhatsApp
   * (Sprint 4). No decide nada por sí sola: solo registra y dispara la
   * lectura tentativa en background (nunca dentro del webhook — Principio IV).
   */
  async receiveFromWhatsapp(params: {
    phone: string;
    messageId: string;
    imagePath: string;
  }) {
    const client = await this.clients.getByPhone(params.phone);
    if (!client) {
      this.logger.warn(
        `Comprobante recibido de un teléfono sin Client asociado: ${params.phone}`,
      );
      return null;
    }

    const quota = await this.prisma.quota.findFirst({
      where: {
        clientId: client.id,
        status: { in: ['PENDING', 'AWAITING_CONFIRMATION', 'OVERDUE'] },
      },
      orderBy: { dueDate: 'asc' },
    });
    if (!quota) {
      this.logger.warn(
        `Comprobante recibido de ${params.phone} sin ninguna cuota vigente`,
      );
      return null;
    }

    const proof = await this.prisma.paymentProof.create({
      data: {
        quotaId: quota.id,
        messageId: params.messageId,
        imagePath: params.imagePath,
      },
    });

    await this.orchestrationLogger.logEvent({
      eventType: 'payment_proof_received',
      payload: { paymentProofId: proof.id, quotaId: quota.id },
    });

    await this.receiptQueue.add(
      'extract-receipt',
      { paymentProofId: proof.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    return proof;
  }

  private async findOrThrow(id: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: proofInclude,
    });
    if (!proof) {
      throw new NotFoundException('Comprobante no encontrado');
    }
    return proof;
  }

  /** 403 si el empleado no es el cobrador asignado ni tiene isController. */
  private assertScope(
    clientCollectorId: string | null,
    employeeId: string,
    isController: boolean,
  ) {
    if (!isController && clientCollectorId !== employeeId) {
      throw new ForbiddenException('No tenés acceso a este comprobante');
    }
  }

  private assertPendingReview(status: string) {
    if (status !== 'PENDING_REVIEW') {
      throw new ConflictException('El comprobante ya fue resuelto');
    }
  }

  /**
   * Vuelve la cuota a PENDING tras rechazar/manejar manualmente un
   * comprobante — PERO nunca si otro comprobante de la misma cuota ya fue
   * ACCEPTED (ej. el cliente mandó dos veces el comprobante y el cobrador
   * ya resolvió uno): pisaría AWAITING_CONFIRMATION con PENDING mientras un
   * comprobante aceptado sigue esperando verificación de impacto. Hallado
   * en validación en vivo, no en los tests con mocks (no modelaban dos
   * PaymentProof sobre la misma Quota).
   */
  private async revertQuotaIfNoOtherAccepted(quotaId: string) {
    const hasAccepted = await this.prisma.paymentProof.findFirst({
      where: { quotaId, status: 'ACCEPTED' },
    });
    if (!hasAccepted) {
      await this.prisma.quota.update({
        where: { id: quotaId },
        data: { status: 'PENDING' },
      });
    }
  }

  async listPendingReview(employeeId: string, isController: boolean) {
    return this.prisma.paymentProof.findMany({
      where: {
        status: 'PENDING_REVIEW',
        ...(isController
          ? {}
          : { quota: { client: { assignedCollectorId: employeeId } } }),
      },
      include: proofInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getImagePath(id: string, employeeId: string, isController: boolean) {
    const proof = await this.findOrThrow(id);
    this.assertScope(
      proof.quota.client.assignedCollectorId,
      employeeId,
      isController,
    );
    return proof.imagePath;
  }

  private async notifyClient(proof: { message: { conversationId: string } | null }, text: string) {
    if (!proof.message) return;
    const conversation = await this.conversations.findById(
      proof.message.conversationId,
    );
    if (!conversation) return;
    await this.sender.send(conversation.externalId, text, conversation.channel);
    await this.conversations.addMessage(
      conversation.id,
      'ASSISTANT',
      text,
      conversation.currentAgent ?? undefined,
    );
  }

  async accept(id: string, employeeId: string) {
    const proof = await this.findOrThrow(id);
    this.assertPendingReview(proof.status);

    const updated = await this.prisma.paymentProof.update({
      where: { id },
      data: { status: 'ACCEPTED', acceptedById: employeeId, acceptedAt: new Date() },
    });

    await this.prisma.quota.update({
      where: { id: proof.quotaId },
      data: { status: 'AWAITING_CONFIRMATION' },
    });

    await this.notifyClient(proof, ACCEPTED_MESSAGE);

    await this.orchestrationLogger.logEvent({
      conversationId: proof.message?.conversationId ?? null,
      eventType: 'payment_proof_accepted',
      payload: { paymentProofId: id, acceptedById: employeeId },
    });

    return updated;
  }

  async reject(id: string, employeeId: string, reason: ProofRejectionReason) {
    const proof = await this.findOrThrow(id);
    this.assertPendingReview(proof.status);

    const updated = await this.prisma.paymentProof.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason },
    });

    await this.revertQuotaIfNoOtherAccepted(proof.quotaId);

    await this.notifyClient(proof, REJECTION_MESSAGES[reason]);

    await this.orchestrationLogger.logEvent({
      conversationId: proof.message?.conversationId ?? null,
      eventType: 'payment_proof_rejected',
      payload: { paymentProofId: id, reason, rejectedById: employeeId },
    });

    return updated;
  }

  async markManualHandling(id: string, employeeId: string, note?: string) {
    const proof = await this.findOrThrow(id);
    this.assertPendingReview(proof.status);
    if (!proof.message) {
      throw new ConflictException(
        'El comprobante no tiene conversación asociada',
      );
    }

    const updated = await this.prisma.paymentProof.update({
      where: { id },
      data: { status: 'MANUAL_HANDLING' },
    });

    await this.conversations.takeover(proof.message.conversationId, employeeId);
    if (note) {
      await this.conversations.addInternalNote(
        proof.message.conversationId,
        employeeId,
        note,
      );
    }

    await this.orchestrationLogger.logEvent({
      conversationId: proof.message.conversationId,
      eventType: 'payment_proof_manual_handling',
      payload: { paymentProofId: id },
    });

    return updated;
  }
}
