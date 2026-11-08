import {
  buildCommercialFollowUpBody,
  FOLLOWUP_REASON_LABELS,
} from './commercial-followup.template';
import {
  computeScheduledFor,
  evaluateFollowUpDecision,
} from './commercial-followup.service';

describe('CommercialFollowUp — reglas de dominio (021 US1 & US2)', () => {
  const baseDate = new Date('2026-11-07T12:00:00.000Z');

  describe('computeScheduledFor (FR-004)', () => {
    it('calcula el vencimiento desde el último mensaje comercial real cuando no hay eventos posteriores', () => {
      const due = computeScheduledFor({
        lastInteractionAt: baseDate,
        ruleEffectiveSince: null,
        lastUnblockedAt: null,
        inactivityHours: 48,
      });
      expect(due?.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    });

    it('inicia un nuevo período desde la habilitación/cambio de la regla si es posterior al último mensaje (US3.4, FR-004)', () => {
      const ruleEffectiveSince = new Date('2026-11-08T10:00:00.000Z');
      const due = computeScheduledFor({
        lastInteractionAt: baseDate,
        ruleEffectiveSince,
        lastUnblockedAt: null,
        inactivityHours: 48,
      });
      expect(due?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
    });

    it('inicia un nuevo período desde el fin de un bloqueo temporal si es posterior al último mensaje (US2.3, FR-006)', () => {
      const lastUnblockedAt = new Date('2026-11-08T15:30:00.000Z');
      const due = computeScheduledFor({
        lastInteractionAt: baseDate,
        ruleEffectiveSince: new Date('2026-11-07T10:00:00.000Z'),
        lastUnblockedAt,
        inactivityHours: 48,
      });
      expect(due?.toISOString()).toBe('2026-11-10T15:30:00.000Z');
    });

    it('reemplaza el vencimiento si el cliente o personal interactúan después de activar la regla (US1.2)', () => {
      const newerInteraction = new Date('2026-11-08T18:00:00.000Z');
      const due = computeScheduledFor({
        lastInteractionAt: newerInteraction,
        ruleEffectiveSince: baseDate,
        lastUnblockedAt: null,
        inactivityHours: 48,
      });
      expect(due?.toISOString()).toBe('2026-11-10T18:00:00.000Z');
    });
  });

  describe('evaluateFollowUpDecision — elegibilidad, candidato único y bloqueos (FR-003, FR-006, FR-008)', () => {
    const baseCtx = () => ({
      prospect: {
        id: 'p-1',
        phone: '+5493764000211',
        name: 'Cliente Demo',
        productInterest: 'Cortadora Berkley',
        status: 'NUEVO',
        closedAt: null,
        conversationId: 'c-1',
      },
      isLatestForPhone: true,
      conversation: {
        id: 'c-1',
        channel: 'WHATSAPP',
        externalId: '+5493764000211',
        userType: 'CLIENTE',
        status: 'ACTIVE',
        handledById: null,
      },
      hasPendingEscalation: false,
      contactOptOut: false,
      latestPurchaseRequest: null as any,
      rule: {
        enabled: true,
        inactivityHours: 48,
        effectiveSince: baseDate,
      },
      existingFollowUp: null as any,
      lastInteractionAt: baseDate,
      derivedUnblockedAt: null as Date | null,
      now: new Date('2026-11-07T14:00:00.000Z'),
    });

    it('programa como SCHEDULED una oportunidad abierta elegible cuando la regla está activa (US1.1)', () => {
      const res = evaluateFollowUpDecision(baseCtx());
      expect(res.status).toBe('SCHEDULED');
      expect(res.reasonCode).toBeNull();
      expect(res.scheduledFor?.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    });

    it('cancela definitivamente oportunidades anteriores del mismo teléfono con SUPERSEDED_BY_NEWER_PROSPECT (US1.4, Clarificación #2)', () => {
      const ctx = baseCtx();
      ctx.isLatestForPhone = false;
      const res = evaluateFollowUpDecision(ctx);
      expect(res.status).toBe('CANCELLED');
      expect(res.reasonCode).toBe('SUPERSEDED_BY_NEWER_PROSPECT');
      expect(res.reasonLabel).toBe(
        FOLLOWUP_REASON_LABELS.SUPERSEDED_BY_NEWER_PROSPECT,
      );
      expect(res.scheduledFor).toBeNull();
    });

    it('no reactiva una oportunidad previamente cancelada por reemplazo aunque vuelva a ser la única abierta (Clarificación #2)', () => {
      const ctx = baseCtx();
      ctx.existingFollowUp = {
        status: 'CANCELLED',
        reasonCode: 'SUPERSEDED_BY_NEWER_PROSPECT',
        completedAt: null,
        cancelledAt: baseDate,
        lastUnblockedAt: null,
      };
      const res = evaluateFollowUpDecision(ctx);
      expect(res.status).toBe('CANCELLED');
      expect(res.reasonCode).toBe('SUPERSEDED_BY_NEWER_PROSPECT');
    });

    it('conserva COMPLETED y no programa un segundo seguimiento cuando el cupo ya fue consumido (US1.3, FR-005)', () => {
      const ctx = baseCtx();
      ctx.existingFollowUp = {
        status: 'COMPLETED',
        reasonCode: null,
        completedAt: baseDate,
        cancelledAt: null,
        lastUnblockedAt: null,
      };
      const res = evaluateFollowUpDecision(ctx);
      expect(res.status).toBe('COMPLETED');
      expect(res.scheduledFor).toBeNull();
    });

    it('bloquea por baja de contacto registrada en 022 (CONTACT_OPT_OUT, US2.5)', () => {
      const ctx = baseCtx();
      ctx.contactOptOut = true;
      const res = evaluateFollowUpDecision(ctx);
      expect(res.status).toBe('BLOCKED');
      expect(res.reasonCode).toBe('CONTACT_OPT_OUT');
    });

    it('bloquea por conversación bajo control humano o escalado pendiente (US2.3)', () => {
      const ctxHuman = baseCtx();
      ctxHuman.conversation.status = 'HUMAN_HANDLING';
      expect(evaluateFollowUpDecision(ctxHuman)).toMatchObject({
        status: 'BLOCKED',
        reasonCode: 'HUMAN_HANDLING',
      });

      const ctxEsc = baseCtx();
      ctxEsc.hasPendingEscalation = true;
      expect(evaluateFollowUpDecision(ctxEsc)).toMatchObject({
        status: 'BLOCKED',
        reasonCode: 'PENDING_ESCALATION',
      });
    });

    it('bloquea por revisión administrativa pendiente, condiciones vencidas o cierre listo de 020 (US2.1, US2.2)', () => {
      const ctxReview = baseCtx();
      ctxReview.latestPurchaseRequest = {
        id: 'pr-1',
        status: 'PENDING_REVIEW',
        closedAt: null,
        commercialFlow: {
          version: 2,
          stage: 'REVIEW',
          startedAt: baseDate.toISOString(),
          expiresAt: '2026-11-09T12:00:00.000Z',
          revision: 1,
          offers: [],
        },
      };
      expect(evaluateFollowUpDecision(ctxReview)).toMatchObject({
        status: 'BLOCKED',
        reasonCode: 'ADMIN_REVIEW_PENDING',
      });

      const ctxReady = baseCtx();
      ctxReady.latestPurchaseRequest = {
        id: 'pr-2',
        status: 'APPROVED',
        closedAt: null,
        commercialFlow: {
          version: 2,
          stage: 'READY',
          startedAt: baseDate.toISOString(),
          expiresAt: '2026-11-09T12:00:00.000Z',
          revision: 1,
          offers: [{ id: 'cash', modality: 'CASH', total: '100000.00' }],
        },
      };
      expect(evaluateFollowUpDecision(ctxReady)).toMatchObject({
        status: 'BLOCKED',
        reasonCode: 'CLOSING_READY_FOR_SALES',
      });

      const ctxExpired = baseCtx();
      ctxExpired.now = new Date('2026-11-10T00:00:00.000Z');
      ctxExpired.latestPurchaseRequest = {
        id: 'pr-3',
        status: 'APPROVED',
        closedAt: null,
        commercialFlow: {
          version: 2,
          stage: 'CHOOSING',
          startedAt: baseDate.toISOString(),
          expiresAt: '2026-11-09T12:00:00.000Z',
          revision: 1,
          offers: [{ id: 'cash', modality: 'CASH', total: '100000.00' }],
        },
      };
      expect(evaluateFollowUpDecision(ctxExpired)).toMatchObject({
        status: 'BLOCKED',
        reasonCode: 'FINANCING_EXPIRED',
      });
    });

    it('permite seguimiento con texto neutral cuando hay ofertas vigentes en etapa CHOOSING y cancela si financiación fue rechazada sin contado (US2.6, Edge Cases)', () => {
      const ctxChoosing = baseCtx();
      ctxChoosing.latestPurchaseRequest = {
        id: 'pr-4',
        status: 'APPROVED',
        closedAt: null,
        commercialFlow: {
          version: 2,
          stage: 'CHOOSING',
          startedAt: baseDate.toISOString(),
          expiresAt: '2026-11-09T12:00:00.000Z',
          revision: 1,
          offers: [{ id: 'cash', modality: 'CASH', total: '100000.00' }],
        },
      };
      const decision = evaluateFollowUpDecision(ctxChoosing);
      expect(decision.status).toBe('SCHEDULED');
      expect(decision.hasActiveChoosingOffers).toBe(true);
      const body = buildCommercialFollowUpBody({
        name: 'Cliente Demo',
        productInterest: 'Cortadora Berkley',
        hasActiveChoosingOffers: decision.hasActiveChoosingOffers,
      });
      expect(body).toContain('dentro de su vigencia');
      expect(body).not.toMatch(/\$|\b100\.?000\b|stock/i);

      const ctxRejectedNoCash = baseCtx();
      ctxRejectedNoCash.latestPurchaseRequest = {
        id: 'pr-5',
        status: 'REJECTED',
        closedAt: null,
        commercialFlow: {
          version: 2,
          stage: 'CHOOSING',
          startedAt: baseDate.toISOString(),
          expiresAt: '2026-11-09T12:00:00.000Z',
          revision: 1,
          offers: [],
        },
      };
      expect(evaluateFollowUpDecision(ctxRejectedNoCash)).toMatchObject({
        status: 'CANCELLED',
        reasonCode: 'FINANCING_REJECTED_NO_CASH',
      });
    });
  });
});
