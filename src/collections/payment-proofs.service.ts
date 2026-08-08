import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Channel,
  PaymentProofStatus,
  ProofRejectionReason,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ClientsService } from '../clients/clients.service';
import { EmployeesService } from '../employees/employees.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { normalizePhone } from '../common/phone';
import { VerifyImpactDto } from './dto/verify-impact.dto';

const REJECTION_MESSAGES: Record<ProofRejectionReason, string> = {
  PAST_DATE:
    'Vimos que el comprobante que enviaste corresponde a una fecha anterior. ¿Podrías enviarnos el comprobante del pago actual? 🙏',
  WRONG_CBU:
    'El comprobante que enviaste no corresponde a la cuenta de la empresa. Por favor revisá el CBU de destino y enviá el comprobante correcto.',
  AMOUNT_TOO_LOW:
    'El monto transferido es menor al que corresponde para esta cuota. ¿Podrías completar la diferencia y enviarnos el comprobante actualizado?',
};

const ACCEPTED_MESSAGE = '¡Recibido, gracias! 🙌';

// Acuse neutral: NO confirma ni rechaza el pago (Principio III — la IA nunca
// decide sola sobre un comprobante), solo avisa que llegó y que un humano lo
// va a revisar. Sin esto el cliente manda la foto y no recibe nada hasta que
// el cobrador lo acepte o rechace desde el panel, lo que en la práctica podía
// tardar horas.
const PROOF_RECEIVED_MESSAGE =
  '📄 Recibimos tu comprobante, gracias. Lo estamos revisando y te confirmamos en breve.';

// No encontramos a quién imputarle el pago. Le pedimos los datos mínimos para
// poder asociarlo (FR-006b) en vez de dejarlo sin respuesta.
const UNMATCHED_PROOF_MESSAGE =
  'Para poder asociar tu pago necesitamos confirmar tus datos: ¿nos pasás tu nombre completo y tu DNI, por favor?';

const proofInclude = {
  message: true,
  quota: { include: { client: { include: { assignedCollector: true } } } },
  // `acceptedBy` resuelto por relación: el Control de Comprobantes tiene que
  // mostrar QUIÉN aceptó (US3/AC1) y un uuid crudo no sirve para eso. Mismo
  // criterio ya aplicado al autor de la nota interna en CollectionsService.
  acceptedBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PaymentProofsService {
  private readonly logger = new Logger(PaymentProofsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly clients: ClientsService,
    private readonly employees: EmployeesService,
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
      await this.registerUnmatchedProof(params, 'NO_CLIENT');
      return null;
    }

    // Imputación: la cuota vigente MÁS ANTIGUA (FR-006a). Es la práctica de
    // cobranza estándar — se cancela primero el vencimiento más viejo.
    const quota = await this.prisma.quota.findFirst({
      where: {
        clientId: client.id,
        status: { in: ['PENDING', 'AWAITING_CONFIRMATION', 'OVERDUE'] },
      },
      orderBy: { dueDate: 'asc' },
    });
    if (!quota) {
      await this.registerUnmatchedProof(params, 'NO_QUOTA');
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

    // Ninguno de los dos avisos debe tirar abajo el webhook si el envío por
    // WhatsApp falla (número fuera de la ventana de sesión, template no
    // aprobado, etc.) — el comprobante ya quedó guardado y en cola para
    // Gemini, que es lo que realmente no puede perderse.
    await this.notifyClientReceived(params.messageId).catch((err) =>
      this.logger.error(`No se pudo acusar recibo a ${params.phone}: ${err}`),
    );
    if (client.assignedCollectorId) {
      await this.notifyCollectorNewProof(
        client.assignedCollectorId,
        client.name,
      ).catch((err) =>
        this.logger.error(
          `No se pudo notificar al cobrador de ${client.name}: ${err}`,
        ),
      );
    }

    return proof;
  }

  /**
   * Un comprobante que no se puede imputar (teléfono sin Client, o Client sin
   * cuota vigente) NO se descarta en silencio (FR-006b). La imagen ya quedó
   * guardada en disco; acá se deja el rastro auditable y se le pide al cliente
   * los datos que permiten asociarlo. Cuando después se dé de alta un Client
   * con ese teléfono, `ClientsService` recupera estos eventos y crea el
   * PaymentProof que faltaba.
   *
   * Antes esto era un `logger.warn` + `return null`: el comprobante existía en
   * disco pero era invisible para toda persona del sistema, y el cliente se
   * quedaba sin respuesta creyendo que su pago estaba en trámite.
   */
  private async registerUnmatchedProof(
    params: { phone: string; messageId: string; imagePath: string },
    reason: 'NO_CLIENT' | 'NO_QUOTA',
  ) {
    this.logger.warn(
      `Comprobante no imputable de ${params.phone} (${reason}) — queda registrado y se piden datos`,
    );

    await this.orchestrationLogger.logEvent({
      eventType: 'payment_proof_unmatched',
      payload: {
        phone: params.phone,
        messageId: params.messageId,
        imagePath: params.imagePath,
        reason,
      },
    });

    await this.notifyClientReceived(params.messageId).catch((err) =>
      this.logger.error(`No se pudo acusar recibo a ${params.phone}: ${err}`),
    );
    await this.askClientForIdentity(params.messageId).catch((err) =>
      this.logger.error(
        `No se pudieron pedir los datos a ${params.phone}: ${err}`,
      ),
    );
  }

  private async askClientForIdentity(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true },
    });
    if (!message) return;
    await this.notifyClient(
      { message: { conversationId: message.conversationId } },
      UNMATCHED_PROOF_MESSAGE,
    );
  }

  /**
   * Recupera los comprobantes que habían quedado sin imputar para un teléfono
   * (FR-006b) y los convierte en casos reales ahora que el cliente existe.
   * Se llama al dar de alta un cliente (US6) — es lo que cierra el círculo del
   * "te pedimos los datos" del mensaje automático.
   *
   * Idempotente: descarta los eventos cuyo `messageId` ya tiene un PaymentProof
   * asociado, así reintentar el alta no duplica comprobantes.
   */
  async reconcileUnmatchedForPhone(phone: string, clientId: string) {
    const normalized = normalizePhone(phone);

    const events = await this.prisma.orchestrationEvent.findMany({
      where: { eventType: 'payment_proof_unmatched' },
      orderBy: { createdAt: 'asc' },
    });
    const mine = events.filter((e) => (e.payload as any)?.phone === normalized);
    if (mine.length === 0) return [];

    const quota = await this.prisma.quota.findFirst({
      where: {
        clientId,
        status: { in: ['PENDING', 'AWAITING_CONFIRMATION', 'OVERDUE'] },
      },
      orderBy: { dueDate: 'asc' },
    });
    if (!quota) return [];

    const recovered = [];
    for (const event of mine) {
      const payload = event.payload as any;

      const already = await this.prisma.paymentProof.findFirst({
        where: { messageId: payload.messageId },
      });
      if (already) continue;

      const proof = await this.prisma.paymentProof.create({
        data: {
          quotaId: quota.id,
          messageId: payload.messageId,
          imagePath: payload.imagePath,
        },
      });

      await this.orchestrationLogger.logEvent({
        eventType: 'payment_proof_received',
        payload: {
          paymentProofId: proof.id,
          quotaId: quota.id,
          recoveredFromUnmatched: true,
        },
      });

      await this.receiptQueue.add(
        'extract-receipt',
        { paymentProofId: proof.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );

      recovered.push(proof);
    }

    if (recovered.length > 0) {
      this.logger.log(
        `Recuperados ${recovered.length} comprobante(s) huérfano(s) de ${normalized}`,
      );
    }
    return recovered;
  }

  private async notifyClientReceived(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true },
    });
    if (!message) return;
    await this.notifyClient(
      { message: { conversationId: message.conversationId } },
      PROOF_RECEIVED_MESSAGE,
    );
  }

  private async notifyCollectorNewProof(
    collectorId: string,
    clientName: string,
  ) {
    const collector = await this.employees
      .findById(collectorId)
      .catch(() => null);
    if (!collector?.isActive) return;
    await this.sender.send(
      collector.phone,
      `📄 Nuevo comprobante de ${clientName} para revisar en el panel de Cobranzas.`,
      Channel.WHATSAPP,
    );
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

  /**
   * `status` es opcional y por default PENDING_REVIEW (comportamiento
   * original): sin esto, un comprobante que el cobrador marcó MANUAL_HANDLING
   * o REJECTED salía de su cola y no tenía ningún endpoint que lo devolviera
   * — el "voy a manejarlo yo" no tenía vuelta atrás en el producto, aunque en
   * la base el comprobante seguía ahí.
   */
  async listPendingReview(
    employeeId: string,
    isController: boolean,
    status: PaymentProofStatus = PaymentProofStatus.PENDING_REVIEW,
  ) {
    return this.prisma.paymentProof.findMany({
      where: {
        status,
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

  private async notifyClient(
    proof: { message: { conversationId: string } | null },
    text: string,
  ) {
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
      data: {
        status: 'ACCEPTED',
        acceptedById: employeeId,
        acceptedAt: new Date(),
      },
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
      // `note ?? null`: si no viene nota, la columna queda NULL (no
      // undefined, que Prisma interpretaría como "no tocar el campo").
      data: { status: 'MANUAL_HANDLING', manualHandlingNote: note ?? null },
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

  /** Lista comprobantes aceptados pendientes de verificación de impacto (Phase 5 — US3). */
  async listAcceptedForImpactReview() {
    return this.prisma.paymentProof.findMany({
      where: { status: 'ACCEPTED' },
      include: proofInclude,
      orderBy: { acceptedAt: 'desc' },
    });
  }

  /**
   * El Cobrador Controlador verifica si un comprobante aceptado realmente
   * impactó en la cuenta bancaria de la empresa (Phase 5 — US3).
   * Si CONFIRMED: cliente recibe confirmación definitiva, Quota → PAID.
   * Si MISSING: cobrador responsable recibe notificación del problema.
   */
  async verifyImpact(id: string, employeeId: string, dto: VerifyImpactDto) {
    const employee = await this.employees.findById(employeeId);
    if (!employee?.isController) {
      throw new ForbiddenException(
        'Solo el Cobrador Controlador puede verificar impacto bancario',
      );
    }

    const proof = await this.findOrThrow(id);

    const updated = await this.prisma.paymentProof.update({
      where: { id },
      data: {
        impactStatus: dto.impactStatus,
        impactVerifiedById: employeeId,
        impactVerifiedAt: new Date(),
        impactObservation: dto.observation,
      },
      include: proofInclude,
    });

    if (dto.impactStatus === 'CONFIRMED') {
      await this.prisma.quota.update({
        where: { id: proof.quotaId },
        data: { status: 'PAID' },
      });

      await this.notifyClient(
        proof,
        '¡Confirmado! Tu pago ha sido procesado correctamente. 🎉',
      );
    } else if (dto.impactStatus === 'MISSING') {
      const assignedCollector = proof.quota.client.assignedCollector;
      if (assignedCollector) {
        await this.sender.send(
          assignedCollector.phone,
          `Atención: El pago del comprobante #${proof.id} no figura en la cuenta de la empresa. Revisá con el cliente.`,
          'WHATSAPP',
        );
      }
    }

    await this.orchestrationLogger.logEvent({
      conversationId: proof.message?.conversationId ?? null,
      eventType: 'payment_impact_verified',
      payload: {
        paymentProofId: id,
        impactStatus: dto.impactStatus,
        verifiedById: employeeId,
      },
    });

    return updated;
  }
}
