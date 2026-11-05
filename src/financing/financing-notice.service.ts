import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import {
  FINANCING_NOTICE_PORT,
  FinancingNoticePort,
  FinancingNoticeResult,
} from './financing-notice.port';
import { financingConflict } from './financing.types';
export const FINANCING_CLAIM_TTL_MS = 60000;
export const FINANCING_RECOVERY_MS = 30000;
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
        include: { conversation: true, purchaseRequest: true },
      });
      if (!notice || notice.status !== 'PENDING') return null;
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
      if (notice.conversation.status !== 'ACTIVE') {
        await tx.outboundCommunication.updateMany({
          where: { id, status: 'PENDING', version: notice.version },
          data: { lastErrorCode: 'HUMAN_PAUSED' },
        });
        return null;
      }
      if (
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
        noticeId: id,
        attemptToken: token,
        body: notice.body,
        destinationFromThread: notice.conversation.externalId,
        version: notice.version + 1,
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
      /^sim:.+/.test(result.providerMessageId);
    const failed = result?.kind === 'NOT_ACCEPTED';
    const status = accepted ? 'ACCEPTED' : failed ? 'FAILED' : 'UNCERTAIN';
    await this.prisma.$transaction(async (tx) => {
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
          acceptedAt: accepted ? new Date() : null,
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
        });
        await tx.orchestrationEvent.create({
          data: {
            conversationId: n.conversationId,
            eventType: `FINANCING_NOTICE_${status}`,
            payload: { requestId: n.purchaseRequestId, noticeId: id },
          },
        });
      }
    });
  }
  async retry(id: string, expectedVersion: number, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.outboundCommunication.findUnique({ where: { id } });
      if (!n) throw new NotFoundException();
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
      if (changed.count !== 1) throw financingConflict('NOTICE_NOT_RETRYABLE');
      await tx.orchestrationEvent.create({
        data: {
          conversationId: n.conversationId,
          eventType: 'FINANCING_NOTICE_RETRY',
          payload: { requestId: n.purchaseRequestId, noticeId: id, actorId },
        },
      });
    });
    const row = await this.prisma.outboundCommunication.findUniqueOrThrow({
      where: { id },
    });
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      transportMode: row.transportMode,
      attemptCount: row.attemptCount,
      lastErrorCode: row.lastErrorCode,
      providerMessageId: row.providerMessageId,
      acceptedAt: row.acceptedAt,
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
                noticeId: row.id,
                errorCode: 'CLAIM_EXPIRED',
              },
            },
          });
      });
  }
}
