import { usesWhatsAppNotice } from './channel-financing-notice.adapter';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import {
  localCrmRecord,
  toCrmSheet,
} from '../ai/integrations/crm-sheet.mapper';
import {
  FINANCING_NOTICE_PORT,
  FinancingNoticePort,
  FinancingNoticeResult,
} from './financing-notice.port';
import { financingConflict } from './financing.types';
import { asCommercialFlow } from './commercial-flow';
import {
  FOLLOWUP_REASON_LABELS,
  FollowUpReasonCode,
} from './commercial-followup.template';
import { phoneVariants } from './contact-preference.service';

export const FINANCING_CLAIM_TTL_MS = 60000;
export const FINANCING_RECOVERY_MS = 30000;
export const MAX_OUTBOUND_ATTEMPTS = 3;

@Injectable()
export class FinancingNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(FINANCING_NOTICE_PORT)
    private readonly transport: FinancingNoticePort,
  ) {}

  async dispatch(id: string) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const notice = await tx.outboundCommunication.findUnique({
        where: { id },
        include: {
          conversation: true,
          purchaseRequest: true,
          prospect: true,
          commercialFollowUp: true,
        },
      });
      if (!notice || notice.status !== 'PENDING') return null;

      if (notice.purpose === 'COMMERCIAL_FOLLOWUP') {
        return this.claimCommercialFollowUp(tx, notice);
      }

      if (notice.attemptCount >= MAX_OUTBOUND_ATTEMPTS) {
        await tx.outboundCommunication.updateMany({
          where: { id, status: 'PENDING', version: notice.version },
          data: { status: 'FAILED', lastErrorCode: 'MAX_ATTEMPTS_REACHED' },
        });
        return null;
      }

      const optOutRows = await tx.contactPreference.findMany({
        where: {
          phone: { in: phoneVariants(notice.conversation.externalId) },
          optOut: true,
        },
      });
      if (optOutRows.length > 0) {
        await tx.outboundCommunication.updateMany({
          where: { id, status: 'PENDING', version: notice.version },
          data: { status: 'FAILED', lastErrorCode: 'CONTACT_OPT_OUT' },
        });
        return null;
      }

      const flow = notice.purchaseRequest
        ? asCommercialFlow(notice.purchaseRequest.commercialFlow)
        : null;
      if (
        flow &&
        notice.purpose === 'FINANCING_DECISION' &&
        (flow.stage === 'REVIEW' ||
          flow.stage === 'CLOSED' ||
          Date.now() >= Date.parse(flow.expiresAt))
      ) {
        await tx.outboundCommunication.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'FAILED', lastErrorCode: 'CONDITIONS_CHANGED' },
        });
        return null;
      }
      const whatsappNotice = usesWhatsAppNotice(this.config, {
        channel: notice.conversation.channel as any,
        purpose: notice.purpose,
      });
      if (
        this.config.get('FINANCING_NOTICE_TRANSPORT', 'disabled') !==
          'simulated' ||
        (notice.transportMode !== 'simulated' &&
          !(whatsappNotice && notice.transportMode === 'whatsapp'))
      ) {
        await tx.outboundCommunication.updateMany({
          where: { id, status: 'PENDING', version: notice.version },
          data: { lastErrorCode: 'TRANSPORT_DISABLED' },
        });
        return null;
      }
      if (
        notice.conversation.status !== 'ACTIVE' ||
        notice.conversation.handledById != null
      ) {
        await tx.outboundCommunication.updateMany({
          where: { id, status: 'PENDING', version: notice.version },
          data: { lastErrorCode: 'HUMAN_PAUSED' },
        });
        return null;
      }
      const pendingEsc = await tx.escalation.findFirst({
        where: { conversationId: notice.conversationId, status: 'PENDING' },
      });
      if (pendingEsc) {
        await tx.outboundCommunication.updateMany({
          where: { id, status: 'PENDING', version: notice.version },
          data: { lastErrorCode: 'PENDING_ESCALATION' },
        });
        return null;
      }
      if (
        !notice.purchaseRequest ||
        !['APPROVED', 'REJECTED'].includes(notice.purchaseRequest.status) ||
        !['WHATSAPP', 'WEB'].includes(notice.conversation.channel) ||
        !/^\+?\d{8,15}$/.test(notice.conversation.externalId)
      )
        return null;
      const token = randomUUID();
      const result = await tx.outboundCommunication.updateMany({
        where: { id, status: 'PENDING', version: notice.version },
        data: {
          status: 'SENDING',
          transportMode: whatsappNotice ? 'whatsapp' : 'simulated',
          attemptToken: token,
          attemptStartedAt: new Date(),
          attemptCount: { increment: 1 },
          version: { increment: 1 },
          lastErrorCode: null,
        },
      });
      if (result.count !== 1) return null;
      const messageId =
        notice.messageId ||
        (
          await tx.message.create({
            data: {
              conversationId: notice.conversationId,
              role: 'ASSISTANT',
              content: notice.body,
              agentType: 'SALES',
            },
          })
        ).id;
      await tx.outboundCommunication.update({
        where: { id },
        data: { messageId },
      });
      await tx.orchestrationEvent.create({
        data: {
          conversationId: notice.conversationId,
          eventType: 'FINANCING_NOTICE_CLAIMED',
          payload: {
            requestId: notice.purchaseRequestId,
            noticeId: id,
            attempt: notice.attemptCount + 1,
          },
        },
      });
      return {
        channel: notice.conversation.channel,
        transportMode: whatsappNotice ? 'whatsapp' : 'simulated',
        noticeId: id,
        attemptToken: token,
        body: notice.body,
        destinationFromThread: notice.conversation.externalId,
        version: notice.version + 1,
        purpose: notice.purpose,
      };
    });
    if (!claimed) return;
    let result: FinancingNoticeResult;
    try {
      result = await this.transport.send(claimed);
    } catch {
      result = { kind: 'UNKNOWN' };
    }
    const accepted =
      result?.kind === 'ACCEPTED' &&
      result.noticeId === id &&
      result.attemptToken === claimed.attemptToken &&
      ('transportMode' in claimed && claimed.transportMode === 'whatsapp'
        ? result.providerMessageId === `n8n:${id}:${claimed.attemptToken}`
        : /^sim:.+/.test(result.providerMessageId));
    const failed = result?.kind === 'NOT_ACCEPTED';
    const status = accepted ? 'ACCEPTED' : failed ? 'FAILED' : 'UNCERTAIN';
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const saved = await tx.outboundCommunication.updateMany({
        where: {
          id,
          status: 'SENDING',
          version: claimed.version,
          attemptToken: claimed.attemptToken,
        },
        data: {
          status,
          version: { increment: 1 },
          providerMessageId: accepted
            ? (result as any).providerMessageId
            : null,
          acceptedAt: accepted ? now : null,
          lastErrorCode: accepted
            ? null
            : failed
              ? 'NOT_ACCEPTED'
              : 'OUTCOME_UNKNOWN',
        },
      });
      if (saved.count) {
        const n = await tx.outboundCommunication.findUniqueOrThrow({
          where: { id },
          include: { prospect: true },
        });
        if (n.purpose === 'COMMERCIAL_FOLLOWUP' && n.prospectId) {
          await tx.commercialFollowUp.updateMany({
            where: { outboundCommunicationId: id },
            data: {
              status: accepted ? 'COMPLETED' : 'SENDING',
              completedAt: accepted ? now : null,
              scheduledFor: null,
              reasonCode: null,
              reasonLabel: null,
              version: { increment: 1 },
            },
          });
          if (accepted && n.prospect) {
            const noteLine = `[${now.toISOString()}] [SEGUIMIENTO AUTOMÁTICO] Recordatorio enviado sobre ${n.prospect.productInterest}`;
            const updatedNotes = [n.prospect.notes, noteLine]
              .filter(Boolean)
              .join('\n');
            const record = localCrmRecord(n.prospect);
            const sheet = toCrmSheet(record);
            sheet.Seguimiento = updatedNotes;
            sheet['Fecha último contacto'] = now.toISOString();
            sheet['Fecha próximo contacto'] = '';
            await tx.prospect.update({
              where: { id: n.prospect.id },
              data: {
                notes: updatedNotes,
                status:
                  n.prospect.status === 'NUEVO'
                    ? 'EN_CONTACTO'
                    : n.prospect.status,
                crmData: JSON.parse(JSON.stringify({ ...record, sheet })),
                syncStatus: 'PENDING',
              },
            });
          }
        }
        await tx.orchestrationEvent.create({
          data: {
            conversationId: n.conversationId,
            eventType:
              n.purpose === 'COMMERCIAL_FOLLOWUP'
                ? `COMMERCIAL_FOLLOWUP_${status}`
                : `FINANCING_NOTICE_${status}`,
            payload: {
              requestId: n.purchaseRequestId,
              prospectId: n.prospectId,
              noticeId: id,
            },
          },
        });
      }
    });
  }

  private async claimCommercialFollowUp(tx: any, notice: any) {
    const id = notice.id;
    const prospect = notice.prospect;
    const conv = notice.conversation;
    if (!prospect || !conv) return null;

    const failPrecheck = async (
      state: 'BLOCKED' | 'CANCELLED',
      code: FollowUpReasonCode,
    ) => {
      await tx.outboundCommunication.updateMany({
        where: { id, status: 'PENDING', version: notice.version },
        data: { status: 'FAILED', lastErrorCode: code },
      });
      await tx.commercialFollowUp.updateMany({
        where: { prospectId: prospect.id },
        data: {
          status: state,
          reasonCode: code,
          reasonLabel: FOLLOWUP_REASON_LABELS[code],
          scheduledFor: null,
          ...(state === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
      return null;
    };

    // Re-verificación atómica inmediatamente antes de contactar (FR-007, SC-003)
    const rule = await tx.commercialFollowUpRule.findUnique({
      where: { id: 'default' },
    });
    if (!rule?.enabled) {
      return failPrecheck('BLOCKED', 'RULE_DISABLED');
    }

    if (
      this.config.get('FINANCING_NOTICE_TRANSPORT', 'disabled') !==
        'simulated' ||
      notice.transportMode !== 'simulated'
    ) {
      await tx.outboundCommunication.updateMany({
        where: { id, status: 'PENDING', version: notice.version },
        data: { lastErrorCode: 'TRANSPORT_DISABLED' },
      });
      return null;
    }

    if (
      prospect.closedAt != null ||
      ['VENTA_CERRADA', 'CERRADO'].includes(prospect.status)
    ) {
      return failPrecheck('CANCELLED', 'SALE_CLOSED');
    }
    if (['CANCELADO', 'CANCELLED'].includes(prospect.status)) {
      return failPrecheck('CANCELLED', 'ORDER_CANCELLED');
    }
    if (['PERDIDO', 'LOST'].includes(prospect.status)) {
      return failPrecheck('CANCELLED', 'PROSPECT_LOST');
    }

    const latestForPhone = await tx.prospect.findFirst({
      where: { phone: prospect.phone },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (latestForPhone && latestForPhone.id !== prospect.id) {
      return failPrecheck('CANCELLED', 'SUPERSEDED_BY_NEWER_PROSPECT');
    }

    const contactPrefRows = await tx.contactPreference.findMany({
      where: { phone: { in: phoneVariants(prospect.phone) }, optOut: true },
    });
    if (contactPrefRows.length > 0) {
      return failPrecheck('BLOCKED', 'CONTACT_OPT_OUT');
    }

    if (
      conv.userType !== 'CLIENTE' ||
      !['WHATSAPP', 'WEB'].includes(conv.channel) ||
      !/^\+?\d{8,15}$/.test(prospect.phone) ||
      conv.externalId !== prospect.phone
    ) {
      return failPrecheck('BLOCKED', 'MISSING_VERIFIED_THREAD');
    }

    if (conv.status !== 'ACTIVE' || conv.handledById != null) {
      return failPrecheck('BLOCKED', 'HUMAN_HANDLING');
    }

    const pendingEsc = await tx.escalation.findFirst({
      where: { conversationId: conv.id, status: 'PENDING' },
    });
    if (pendingEsc) {
      return failPrecheck('BLOCKED', 'PENDING_ESCALATION');
    }

    const latestReq = await tx.purchaseRequest.findFirst({
      where: {
        OR: [{ prospectId: prospect.id }, { conversationId: conv.id }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latestReq) {
      const flow = asCommercialFlow(latestReq.commercialFlow);
      if (latestReq.closedAt != null || flow?.stage === 'CLOSED') {
        return failPrecheck('CANCELLED', 'SALE_CLOSED');
      }
      if (latestReq.status === 'CANCELLED') {
        return failPrecheck('CANCELLED', 'ORDER_CANCELLED');
      }
      if (latestReq.status === 'REJECTED') {
        const hasCash =
          !!flow &&
          Array.isArray(flow.offers) &&
          flow.offers.some((o) => o.modality === 'CASH');
        if (!hasCash) {
          return failPrecheck('CANCELLED', 'FINANCING_REJECTED_NO_CASH');
        }
      }
      if (latestReq.status === 'PENDING_REVIEW' || flow?.stage === 'REVIEW') {
        return failPrecheck('BLOCKED', 'ADMIN_REVIEW_PENDING');
      }
      if (flow?.stage === 'READY') {
        return failPrecheck('BLOCKED', 'CLOSING_READY_FOR_SALES');
      }
      if (flow && Date.now() >= Date.parse(flow.expiresAt)) {
        return failPrecheck('BLOCKED', 'FINANCING_EXPIRED');
      }
    }

    const token = randomUUID();
    const result = await tx.outboundCommunication.updateMany({
      where: { id, status: 'PENDING', version: notice.version },
      data: {
        status: 'SENDING',
        attemptToken: token,
        attemptStartedAt: new Date(),
        attemptCount: { increment: 1 },
        version: { increment: 1 },
        lastErrorCode: null,
      },
    });
    if (result.count !== 1) return null;

    await tx.commercialFollowUp.updateMany({
      where: { prospectId: prospect.id },
      data: {
        status: 'SENDING',
        outboundCommunicationId: id,
        version: { increment: 1 },
      },
    });

    const messageId =
      notice.messageId ||
      (
        await tx.message.create({
          data: {
            conversationId: notice.conversationId,
            role: 'ASSISTANT',
            content: notice.body,
            agentType: 'SALES',
          },
        })
      ).id;
    await tx.outboundCommunication.update({
      where: { id },
      data: { messageId },
    });
    await tx.orchestrationEvent.create({
      data: {
        conversationId: notice.conversationId,
        eventType: 'COMMERCIAL_FOLLOWUP_CLAIMED',
        payload: {
          prospectId: prospect.id,
          noticeId: id,
          attempt: notice.attemptCount + 1,
        },
      },
    });
    return {
      noticeId: id,
      attemptToken: token,
      body: notice.body,
      destinationFromThread: conv.externalId,
      version: notice.version + 1,
      purpose: notice.purpose,
    };
  }

  async confirmDelivery(
    id: string,
    opts?: { providerMessageId?: string; source?: string },
  ) {
    const source = opts?.source || 'simulated';
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.outboundCommunication.findUnique({ where: { id } });
      if (!n) throw new NotFoundException();

      if (
        opts?.providerMessageId &&
        n.providerMessageId &&
        opts.providerMessageId !== n.providerMessageId
      ) {
        throw financingConflict('PROVIDER_MESSAGE_MISMATCH');
      }

      // Idempotente ante confirmaciones repetidas o fuera de orden: jamás retrocede DELIVERED (US3.4, FR-007, SC-003)
      if (n.status === 'DELIVERED') {
        return;
      }

      if (n.status !== 'ACCEPTED' || !n.providerMessageId) {
        throw financingConflict('NOTICE_NOT_ACCEPTED');
      }

      const now = new Date();
      const changed = await tx.outboundCommunication.updateMany({
        where: { id, status: 'ACCEPTED', version: n.version },
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
          deliverySource: source,
          version: { increment: 1 },
        },
      });
      if (changed.count === 1) {
        await tx.orchestrationEvent.create({
          data: {
            conversationId: n.conversationId,
            eventType:
              n.purpose === 'COMMERCIAL_FOLLOWUP'
                ? 'COMMERCIAL_FOLLOWUP_DELIVERED'
                : 'FINANCING_NOTICE_DELIVERED',
            payload: {
              requestId: n.purchaseRequestId,
              prospectId: n.prospectId,
              noticeId: id,
              providerMessageId: n.providerMessageId,
              deliverySource: source,
            },
          },
        });
      }
    });

    const row = await this.prisma.outboundCommunication.findUniqueOrThrow({
      where: { id },
    });
    return this.formatNotice(row);
  }

  async retry(id: string, expectedVersion: number, actorId: string) {
    const blockedCode = await this.prisma.$transaction(async (tx) => {
      const n = await tx.outboundCommunication.findUnique({
        where: { id },
        include: { conversation: true, purchaseRequest: true },
      });
      if (!n) throw new NotFoundException();
      if (n.status !== 'FAILED' || n.version !== expectedVersion) {
        return 'NOTICE_NOT_RETRYABLE';
      }
      if (n.attemptCount >= MAX_OUTBOUND_ATTEMPTS) {
        await tx.outboundCommunication.updateMany({
          where: { id, version: expectedVersion },
          data: { lastErrorCode: 'MAX_ATTEMPTS_REACHED' },
        });
        return 'MAX_ATTEMPTS_REACHED';
      }

      const optOutRows = await tx.contactPreference.findMany({
        where: {
          phone: { in: phoneVariants(n.conversation.externalId) },
          optOut: true,
        },
      });
      if (optOutRows.length > 0) {
        await tx.outboundCommunication.updateMany({
          where: { id, version: expectedVersion },
          data: { lastErrorCode: 'CONTACT_OPT_OUT' },
        });
        return 'CONTACT_OPT_OUT';
      }

      if (
        n.conversation.status !== 'ACTIVE' ||
        n.conversation.handledById != null
      ) {
        await tx.outboundCommunication.updateMany({
          where: { id, version: expectedVersion },
          data: { lastErrorCode: 'HUMAN_PAUSED' },
        });
        return 'HUMAN_PAUSED';
      }

      const pendingEsc = await tx.escalation.findFirst({
        where: { conversationId: n.conversationId, status: 'PENDING' },
      });
      if (pendingEsc) {
        await tx.outboundCommunication.updateMany({
          where: { id, version: expectedVersion },
          data: { lastErrorCode: 'PENDING_ESCALATION' },
        });
        return 'PENDING_ESCALATION';
      }

      if (n.purchaseRequest) {
        const flow = asCommercialFlow(n.purchaseRequest.commercialFlow);
        if (
          !['APPROVED', 'REJECTED'].includes(n.purchaseRequest.status) ||
          n.purchaseRequest.closedAt != null ||
          (flow &&
            (flow.stage === 'REVIEW' ||
              flow.stage === 'CLOSED' ||
              Date.now() >= Date.parse(flow.expiresAt)))
        ) {
          await tx.outboundCommunication.updateMany({
            where: { id, version: expectedVersion },
            data: { lastErrorCode: 'CONDITIONS_CHANGED' },
          });
          return 'CONDITIONS_CHANGED';
        }
      }

      const changed = await tx.outboundCommunication.updateMany({
        where: { id, status: 'FAILED', version: expectedVersion },
        data: {
          status: 'PENDING',
          version: { increment: 1 },
          attemptToken: null,
          attemptStartedAt: null,
          lastErrorCode: null,
        },
      });
      if (changed.count !== 1) return 'NOTICE_NOT_RETRYABLE';
      await tx.orchestrationEvent.create({
        data: {
          conversationId: n.conversationId,
          eventType: 'FINANCING_NOTICE_RETRY',
          payload: {
            requestId: n.purchaseRequestId,
            prospectId: n.prospectId,
            noticeId: id,
            actorId,
          },
        },
      });
      return null;
    });
    if (blockedCode) {
      throw financingConflict(blockedCode);
    }
    const row = await this.prisma.outboundCommunication.findUniqueOrThrow({
      where: { id },
    });
    return this.formatNotice(row);
  }

  private formatNotice(row: any) {
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      transportMode: row.transportMode,
      attemptCount: row.attemptCount,
      lastErrorCode: row.lastErrorCode,
      providerMessageId: row.providerMessageId,
      acceptedAt: row.acceptedAt,
      deliveredAt: row.deliveredAt ?? null,
      deliverySource: row.deliverySource ?? null,
    };
  }

  async expireClaims() {
    const expired = await this.prisma.outboundCommunication.findMany({
      where: {
        status: 'SENDING',
        attemptStartedAt: { lt: new Date(Date.now() - FINANCING_CLAIM_TTL_MS) },
      },
      take: 100,
    });
    for (const row of expired)
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.outboundCommunication.updateMany({
          where: { id: row.id, status: 'SENDING', version: row.version },
          data: {
            status: 'UNCERTAIN',
            version: { increment: 1 },
            lastErrorCode: 'CLAIM_EXPIRED',
          },
        });
        if (result.count)
          await tx.orchestrationEvent.create({
            data: {
              conversationId: row.conversationId,
              eventType: 'FINANCING_NOTICE_UNCERTAIN',
              payload: {
                requestId: row.purchaseRequestId,
                prospectId: row.prospectId,
                noticeId: row.id,
                errorCode: 'CLAIM_EXPIRED',
              },
            },
          });
      });
  }
}
