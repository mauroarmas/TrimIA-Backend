import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommercialFollowUpState } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CrmSyncService } from '../ai/integrations/crm-sync.service';
import { localCrmRecord, toCrmSheet } from '../ai/integrations/crm-sheet.mapper';
import { asCommercialFlow } from './commercial-flow';
import {
  buildCommercialFollowUpBody,
  FOLLOWUP_REASON_LABELS,
  FollowUpReasonCode,
} from './commercial-followup.template';
import { phoneVariants } from './contact-preference.service';
import { FinancingNoticeService } from './financing-notice.service';
import { financingConflict } from './financing.types';

export function computeScheduledFor(params: {
  lastInteractionAt: Date | null;
  ruleEffectiveSince: Date | null;
  lastUnblockedAt: Date | null;
  inactivityHours: number;
}): Date | null {
  if (!params.lastInteractionAt) return null;
  const baseMs = Math.max(
    params.lastInteractionAt.getTime(),
    params.ruleEffectiveSince ? params.ruleEffectiveSince.getTime() : 0,
    params.lastUnblockedAt ? params.lastUnblockedAt.getTime() : 0,
  );
  return new Date(baseMs + params.inactivityHours * 3600 * 1000);
}

export interface FollowUpEvaluationContext {
  prospect: {
    id: string;
    phone: string;
    name: string;
    productInterest: string;
    status: string;
    closedAt: Date | null;
    conversationId: string | null;
  };
  isLatestForPhone: boolean;
  conversation: {
    id: string;
    channel: string;
    externalId: string;
    userType: string;
    status: string;
    handledById: string | null;
  } | null;
  hasPendingEscalation: boolean;
  contactOptOut: boolean;
  latestPurchaseRequest: {
    id: string;
    status: string;
    closedAt: Date | null;
    commercialFlow: unknown;
  } | null;
  rule: {
    enabled: boolean;
    inactivityHours: number;
    effectiveSince: Date | null;
  };
  existingFollowUp: {
    status: CommercialFollowUpState;
    reasonCode: string | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    lastUnblockedAt: Date | null;
  } | null;
  lastInteractionAt: Date | null;
  derivedUnblockedAt?: Date | null;
  now: Date;
}

export interface FollowUpDecision {
  status: CommercialFollowUpState;
  reasonCode: FollowUpReasonCode | null;
  reasonLabel: string | null;
  scheduledFor: Date | null;
  lastUnblockedAt: Date | null;
  hasActiveChoosingOffers: boolean;
}

const CLOSED_PROSPECT_STATUSES = ['VENTA_CERRADA', 'CERRADO'];
const CANCELLED_PROSPECT_STATUSES = ['CANCELADO', 'CANCELLED'];
const LOST_PROSPECT_STATUSES = ['PERDIDO', 'LOST'];

export function evaluateFollowUpDecision(
  ctx: FollowUpEvaluationContext,
): FollowUpDecision {
  const existing = ctx.existingFollowUp;
  if (existing?.status === 'COMPLETED' || existing?.completedAt != null) {
    return {
      status: 'COMPLETED',
      reasonCode: null,
      reasonLabel: null,
      scheduledFor: null,
      lastUnblockedAt: existing.lastUnblockedAt,
      hasActiveChoosingOffers: false,
    };
  }

  if (
    existing?.status === 'CANCELLED' &&
    existing.reasonCode === 'SUPERSEDED_BY_NEWER_PROSPECT'
  ) {
    return {
      status: 'CANCELLED',
      reasonCode: 'SUPERSEDED_BY_NEWER_PROSPECT',
      reasonLabel: FOLLOWUP_REASON_LABELS.SUPERSEDED_BY_NEWER_PROSPECT,
      scheduledFor: null,
      lastUnblockedAt: existing.lastUnblockedAt,
      hasActiveChoosingOffers: false,
    };
  }

  const req = ctx.latestPurchaseRequest;
  const flow = req ? asCommercialFlow(req.commercialFlow) : null;

  const cancel = (code: FollowUpReasonCode): FollowUpDecision => ({
    status: 'CANCELLED',
    reasonCode: code,
    reasonLabel: FOLLOWUP_REASON_LABELS[code],
    scheduledFor: null,
    lastUnblockedAt: existing?.lastUnblockedAt ?? null,
    hasActiveChoosingOffers: false,
  });

  if (
    ctx.prospect.closedAt != null ||
    CLOSED_PROSPECT_STATUSES.includes(ctx.prospect.status) ||
    req?.closedAt != null ||
    flow?.stage === 'CLOSED'
  ) {
    return cancel('SALE_CLOSED');
  }

  if (
    CANCELLED_PROSPECT_STATUSES.includes(ctx.prospect.status) ||
    req?.status === 'CANCELLED'
  ) {
    return cancel('ORDER_CANCELLED');
  }

  if (LOST_PROSPECT_STATUSES.includes(ctx.prospect.status)) {
    return cancel('PROSPECT_LOST');
  }

  if (!ctx.isLatestForPhone) {
    return cancel('SUPERSEDED_BY_NEWER_PROSPECT');
  }

  if (req?.status === 'REJECTED') {
    const hasEnabledCash =
      !!flow &&
      Array.isArray(flow.offers) &&
      flow.offers.some((o) => o.modality === 'CASH');
    if (!hasEnabledCash) {
      return cancel('FINANCING_REJECTED_NO_CASH');
    }
  }

  const block = (code: FollowUpReasonCode): FollowUpDecision => ({
    status: 'BLOCKED',
    reasonCode: code,
    reasonLabel: FOLLOWUP_REASON_LABELS[code],
    scheduledFor: null,
    lastUnblockedAt: existing?.lastUnblockedAt ?? null,
    hasActiveChoosingOffers: false,
  });

  if (ctx.contactOptOut) {
    return block('CONTACT_OPT_OUT');
  }

  const conv = ctx.conversation;
  if (
    !conv ||
    conv.userType !== 'CLIENTE' ||
    !['WHATSAPP', 'WEB'].includes(conv.channel) ||
    !/^\+?\d{8,15}$/.test(ctx.prospect.phone) ||
    conv.externalId !== ctx.prospect.phone
  ) {
    return block('MISSING_VERIFIED_THREAD');
  }

  if (!ctx.prospect.productInterest?.trim() || !ctx.lastInteractionAt) {
    return block('MISSING_PRODUCT_INTEREST');
  }

  if (conv.status !== 'ACTIVE' || conv.handledById != null) {
    return block('HUMAN_HANDLING');
  }

  if (ctx.hasPendingEscalation) {
    return block('PENDING_ESCALATION');
  }

  if (req?.status === 'PENDING_REVIEW' || flow?.stage === 'REVIEW') {
    return block('ADMIN_REVIEW_PENDING');
  }

  if (flow?.stage === 'READY') {
    return block('CLOSING_READY_FOR_SALES');
  }

  if (flow && ctx.now.getTime() >= Date.parse(flow.expiresAt)) {
    return block('FINANCING_EXPIRED');
  }

  if (!ctx.rule.enabled) {
    return block('RULE_DISABLED');
  }

  let lastUnblockedAt = existing?.lastUnblockedAt ?? null;
  if (
    existing?.status === 'BLOCKED' &&
    existing.reasonCode &&
    existing.reasonCode !== 'RULE_DISABLED'
  ) {
    lastUnblockedAt = ctx.now;
  }
  if (
    ctx.derivedUnblockedAt &&
    (!lastUnblockedAt ||
      ctx.derivedUnblockedAt.getTime() > lastUnblockedAt.getTime())
  ) {
    lastUnblockedAt = ctx.derivedUnblockedAt;
  }

  const scheduledFor = computeScheduledFor({
    lastInteractionAt: ctx.lastInteractionAt,
    ruleEffectiveSince: ctx.rule.effectiveSince,
    lastUnblockedAt,
    inactivityHours: ctx.rule.inactivityHours,
  });

  const hasActiveChoosingOffers =
    !!flow &&
    flow.stage === 'CHOOSING' &&
    Array.isArray(flow.offers) &&
    flow.offers.length > 0 &&
    ctx.now.getTime() < Date.parse(flow.expiresAt);

  return {
    status: 'SCHEDULED',
    reasonCode: null,
    reasonLabel: null,
    scheduledFor,
    lastUnblockedAt,
    hasActiveChoosingOffers,
  };
}

@Injectable()
export class CommercialFollowUpService {
  private readonly inFlightDispatches = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notices: FinancingNoticeService,
    @Optional() private readonly crmSync?: CrmSyncService,
  ) {}

  private get transportMode(): 'disabled' | 'simulated' {
    return this.config.get('FINANCING_NOTICE_TRANSPORT', 'disabled') ===
      'simulated'
      ? 'simulated'
      : 'disabled';
  }

  async ensureRule() {
    return this.prisma.commercialFollowUpRule.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        enabled: false,
        inactivityHours: 48,
        version: 1,
      },
      update: {},
    });
  }

  async getRule() {
    const rule = await this.ensureRule();
    return {
      id: rule.id,
      enabled: rule.enabled,
      inactivityHours: rule.inactivityHours,
      version: rule.version,
      effectiveSince: rule.effectiveSince
        ? rule.effectiveSince.toISOString()
        : null,
      transportMode: this.transportMode,
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  async updateRule(
    dto: {
      enabled: boolean;
      inactivityHours: number;
      expectedVersion: number;
    },
    actorId: string,
  ) {
    if (
      typeof dto.enabled !== 'boolean' ||
      !Number.isInteger(dto.inactivityHours) ||
      dto.inactivityHours < 1 ||
      dto.inactivityHours > 720 ||
      !Number.isInteger(dto.expectedVersion) ||
      dto.expectedVersion < 1
    ) {
      throw new BadRequestException(
        'La regla requiere habilitación booleana, plazo entero entre 1 y 720 horas y versión esperada válida.',
      );
    }

    await this.ensureRule();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.commercialFollowUpRule.findUniqueOrThrow({
        where: { id: 'default' },
      });
      if (current.version !== dto.expectedVersion) {
        throw financingConflict('STALE_VERSION');
      }
      const resetEffectiveSince =
        dto.enabled &&
        (!current.enabled || current.inactivityHours !== dto.inactivityHours);
      const updated = await tx.commercialFollowUpRule.updateMany({
        where: { id: 'default', version: dto.expectedVersion },
        data: {
          enabled: dto.enabled,
          inactivityHours: dto.inactivityHours,
          version: { increment: 1 },
          updatedById: actorId,
          ...(resetEffectiveSince ? { effectiveSince: now } : {}),
        },
      });
      if (updated.count !== 1) {
        throw financingConflict('STALE_VERSION');
      }
    });

    await this.refreshOpenProspects();
    return this.getRule();
  }

  async refreshOpenProspects() {
    const prospects = await this.prisma.prospect.findMany({
      where: {
        closedAt: null,
        status: { notIn: ['VENTA_CERRADA', 'PERDIDO', 'CANCELADO'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    for (const p of prospects) {
      await this.evaluateProspect(p.id);
    }
  }

  async getProspectFollowUpStatus(prospectId: string) {
    return this.evaluateProspect(prospectId);
  }

  async simulateDue(prospectId: string) {
    if (this.transportMode !== 'simulated') {
      throw new ConflictException(
        'La simulación de vencimiento requiere transporte simulado habilitado.',
      );
    }
    return this.evaluateProspect(prospectId, { simulateDueNow: true });
  }

  async processDueFollowUps() {
    const rule = await this.ensureRule();
    if (!rule.enabled) return 0;
    await this.refreshOpenProspects();
    const dueRows = await this.prisma.commercialFollowUp.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: { lte: new Date() },
      },
      take: 50,
    });
    let dispatched = 0;
    for (const row of dueRows) {
      const res = await this.evaluateProspect(row.prospectId, {
        dispatchIfDue: true,
      });
      if (res.status === 'COMPLETED' || res.status === 'SENDING') {
        dispatched++;
      }
    }
    return dispatched;
  }

  async evaluateProspect(
    prospectId: string,
    options?: { simulateDueNow?: boolean; dispatchIfDue?: boolean },
  ) {
    const prospect = await this.prisma.prospect.findUnique({
      where: { id: prospectId },
    });
    if (!prospect) {
      throw new NotFoundException('Prospecto no encontrado');
    }

    const rule = await this.ensureRule();
    const now = new Date();

    // Determinar candidato más reciente por teléfono y cancelar anteriores pendientes
    const samePhoneProspects = await this.prisma.prospect.findMany({
      where: { phone: prospect.phone },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, conversationId: true },
    });
    const latestForPhoneId = samePhoneProspects[0]?.id ?? prospect.id;
    const isLatestForPhone = latestForPhoneId === prospect.id;

    if (samePhoneProspects.length > 1) {
      const olderIds = samePhoneProspects.slice(1).map((p) => p.id);
      for (const older of samePhoneProspects.slice(1)) {
        const existingOlder = await this.prisma.commercialFollowUp.findUnique({
          where: { prospectId: older.id },
        });
        if (!existingOlder) {
          await this.prisma.commercialFollowUp.create({
            data: {
              prospectId: older.id,
              conversationId: older.conversationId,
              status: 'CANCELLED',
              reasonCode: 'SUPERSEDED_BY_NEWER_PROSPECT',
              reasonLabel: FOLLOWUP_REASON_LABELS.SUPERSEDED_BY_NEWER_PROSPECT,
              cancelledAt: now,
              evaluatedAt: now,
            },
          });
        } else if (
          existingOlder.status !== 'COMPLETED' &&
          existingOlder.status !== 'CANCELLED'
        ) {
          await this.prisma.commercialFollowUp.updateMany({
            where: {
              id: existingOlder.id,
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
            },
            data: {
              status: 'CANCELLED',
              reasonCode: 'SUPERSEDED_BY_NEWER_PROSPECT',
              reasonLabel: FOLLOWUP_REASON_LABELS.SUPERSEDED_BY_NEWER_PROSPECT,
              scheduledFor: null,
              cancelledAt: now,
              evaluatedAt: now,
              version: { increment: 1 },
            },
          });
        }
      }
      void olderIds;
    }

    const [
      conversation,
      lastCommercialMsg,
      pendingEscalation,
      lastClosedEscalation,
      contactPref,
      latestPurchaseRequest,
      existingFollowUp,
    ] = await Promise.all([
      prospect.conversationId
        ? this.prisma.conversation.findUnique({
            where: { id: prospect.conversationId },
          })
        : Promise.resolve(null),
      prospect.conversationId
        ? this.prisma.message.findFirst({
            where: {
              conversationId: prospect.conversationId,
              role: { in: ['USER', 'ASSISTANT'] },
              outboundCommunication: { is: null },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve(null),
      prospect.conversationId
        ? this.prisma.escalation.findFirst({
            where: {
              conversationId: prospect.conversationId,
              status: 'PENDING',
            },
          })
        : Promise.resolve(null),
      prospect.conversationId
        ? this.prisma.escalation.findFirst({
            where: {
              conversationId: prospect.conversationId,
              status: 'RESOLVED',
            },
            orderBy: { resolvedAt: 'desc' },
          })
        : Promise.resolve(null),
      this.prisma.contactPreference
        .findMany({
          where: { phone: { in: phoneVariants(prospect.phone) } },
          orderBy: { updatedAt: 'desc' },
        })
        .then((rows) => rows.find((r) => r.optOut) ?? rows[0] ?? null),
      this.prisma.purchaseRequest.findFirst({
        where: {
          OR: [
            { prospectId: prospect.id },
            ...(prospect.conversationId
              ? [{ conversationId: prospect.conversationId }]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.commercialFollowUp.findUnique({
        where: { prospectId: prospect.id },
        include: { outboundCommunication: true },
      }),
    ]);

    const derivedDates: number[] = [];
    if (lastClosedEscalation?.resolvedAt) {
      derivedDates.push(lastClosedEscalation.resolvedAt.getTime());
    }
    if (lastClosedEscalation?.discardedAt) {
      derivedDates.push(lastClosedEscalation.discardedAt.getTime());
    }
    if (latestPurchaseRequest?.reviewedAt) {
      derivedDates.push(latestPurchaseRequest.reviewedAt.getTime());
    }
    if (contactPref && !contactPref.optOut) {
      derivedDates.push(contactPref.updatedAt.getTime());
    }
    const derivedUnblockedAt =
      derivedDates.length > 0 ? new Date(Math.max(...derivedDates)) : null;

    const decision = evaluateFollowUpDecision({
      prospect,
      isLatestForPhone,
      conversation,
      hasPendingEscalation: !!pendingEscalation,
      contactOptOut: !!contactPref?.optOut,
      latestPurchaseRequest,
      rule,
      existingFollowUp,
      lastInteractionAt: lastCommercialMsg?.createdAt ?? null,
      derivedUnblockedAt,
      now,
    });

    const savedFollowUp = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Prospect" WHERE id = ${prospect.id} FOR UPDATE`;
      const current = await tx.commercialFollowUp.findUnique({
        where: { prospectId: prospect.id },
        include: { outboundCommunication: true },
      });
      if (current?.status === 'COMPLETED' || current?.completedAt != null) {
        return current;
      }
      if (
        current?.status === 'CANCELLED' &&
        current.reasonCode === 'SUPERSEDED_BY_NEWER_PROSPECT'
      ) {
        return current;
      }
      return tx.commercialFollowUp.upsert({
        where: { prospectId: prospect.id },
        create: {
          prospectId: prospect.id,
          conversationId: prospect.conversationId,
          status: decision.status,
          reasonCode: decision.reasonCode,
          reasonLabel: decision.reasonLabel,
          lastInteractionAt: lastCommercialMsg?.createdAt ?? null,
          lastUnblockedAt: decision.lastUnblockedAt,
          scheduledFor: decision.scheduledFor,
          evaluatedAt: now,
          cancelledAt:
            decision.status === 'CANCELLED'
              ? (current?.cancelledAt ?? now)
              : null,
          completedAt:
            decision.status === 'COMPLETED'
              ? (current?.completedAt ?? now)
              : null,
        },
        update: {
          conversationId: prospect.conversationId,
          status: decision.status,
          reasonCode: decision.reasonCode,
          reasonLabel: decision.reasonLabel,
          lastInteractionAt: lastCommercialMsg?.createdAt ?? null,
          lastUnblockedAt: decision.lastUnblockedAt,
          scheduledFor: decision.scheduledFor,
          evaluatedAt: now,
          ...(decision.status === 'CANCELLED' && !current?.cancelledAt
            ? { cancelledAt: now }
            : {}),
          version: { increment: 1 },
        },
        include: { outboundCommunication: true },
      });
    });

    await this.updateProspectNextFollowUpColumn(
      prospect.id,
      savedFollowUp.status === 'SCHEDULED' ? savedFollowUp.scheduledFor : null,
    );

    const shouldDispatch =
      savedFollowUp.status === 'SCHEDULED' &&
      !!conversation &&
      (options?.simulateDueNow === true ||
        (options?.dispatchIfDue === true &&
          !!savedFollowUp.scheduledFor &&
          now.getTime() >= savedFollowUp.scheduledFor.getTime()));

    if (shouldDispatch && conversation) {
      const body = buildCommercialFollowUpBody({
        name: prospect.name,
        productInterest: prospect.productInterest,
        hasActiveChoosingOffers: decision.hasActiveChoosingOffers,
      });
      const dedupeKey = `commercial-followup:${prospect.id}`;
      const outbound = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Prospect" WHERE id = ${prospect.id} FOR UPDATE`;
        const currentFollowUp = await tx.commercialFollowUp.findUnique({
          where: { prospectId: prospect.id },
          include: { outboundCommunication: true },
        });
        if (
          !currentFollowUp ||
          currentFollowUp.status === 'COMPLETED' ||
          currentFollowUp.status === 'CANCELLED'
        ) {
          return currentFollowUp?.outboundCommunication ?? null;
        }
        const existingComm = await tx.outboundCommunication.findUnique({
          where: { dedupeKey },
        });
        const comm =
          existingComm ??
          (await tx.outboundCommunication.create({
            data: {
              purpose: 'COMMERCIAL_FOLLOWUP',
              dedupeKey,
              prospectId: prospect.id,
              conversationId: conversation.id,
              body,
              status: 'PENDING',
              transportMode: this.transportMode,
            },
          }));
        if (currentFollowUp.outboundCommunicationId !== comm.id) {
          await tx.commercialFollowUp.update({
            where: { id: currentFollowUp.id },
            data: {
              outboundCommunicationId: comm.id,
            },
          });
        }
        return comm;
      });

      if (outbound) {
        const existingPromise = this.inFlightDispatches.get(prospect.id);
        if (existingPromise) {
          await existingPromise;
        } else if (outbound.status === 'PENDING') {
          const dispatchPromise = (async () => {
            try {
              await this.notices.dispatch(outbound.id);
              if (this.crmSync) {
                await this.crmSync
                  .syncProspectById(prospect.id)
                  .catch(() => null);
              }
            } finally {
              this.inFlightDispatches.delete(prospect.id);
            }
          })();
          this.inFlightDispatches.set(prospect.id, dispatchPromise);
          await dispatchPromise;
        }
      }
    }

    const pendingInFlight = this.inFlightDispatches.get(prospect.id);
    if (pendingInFlight) {
      await pendingInFlight;
    }

    return this.formatStatus(prospect.id);
  }

  private async updateProspectNextFollowUpColumn(
    prospectId: string,
    scheduledFor: Date | null,
  ) {
    const local = await this.prisma.prospect.findUnique({
      where: { id: prospectId },
    });
    if (!local) return;
    const record = localCrmRecord(local);
    const sheet = toCrmSheet(record);
    const nextDateStr = scheduledFor ? scheduledFor.toISOString() : '';
    if (sheet['Fecha próximo contacto'] === nextDateStr) return;
    sheet['Fecha próximo contacto'] = nextDateStr;
    await this.prisma.prospect.update({
      where: { id: prospectId },
      data: {
        crmData: JSON.parse(JSON.stringify({ ...record, sheet })),
      },
    });
  }

  async formatStatus(prospectId: string) {
    const [prospect, followUp] = await Promise.all([
      this.prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } }),
      this.prisma.commercialFollowUp.findUnique({
        where: { prospectId },
        include: { outboundCommunication: true },
      }),
    ]);

    const comm = followUp?.outboundCommunication ?? null;
    return {
      prospectId: prospect.id,
      status: followUp?.status ?? 'BLOCKED',
      reasonCode: followUp?.reasonCode ?? null,
      reasonLabel: followUp?.reasonLabel ?? null,
      lastInteractionAt: followUp?.lastInteractionAt
        ? followUp.lastInteractionAt.toISOString()
        : null,
      scheduledFor: followUp?.scheduledFor
        ? followUp.scheduledFor.toISOString()
        : null,
      completedAt: followUp?.completedAt
        ? followUp.completedAt.toISOString()
        : null,
      cancelledAt: followUp?.cancelledAt
        ? followUp.cancelledAt.toISOString()
        : null,
      crmSyncStatus: prospect.syncStatus,
      lastSyncedAt: prospect.lastSyncedAt
        ? prospect.lastSyncedAt.toISOString()
        : null,
      communication: comm
        ? {
            id: comm.id,
            status: comm.status,
            transportMode: comm.transportMode,
            providerMessageId: comm.providerMessageId,
            attemptCount: comm.attemptCount,
            lastErrorCode: comm.lastErrorCode,
            acceptedAt: comm.acceptedAt ? comm.acceptedAt.toISOString() : null,
            deliveredAt: comm.deliveredAt
              ? comm.deliveredAt.toISOString()
              : null,
            deliverySource: (comm as any).deliverySource ?? null,
          }
        : null,
    };
  }
}
