import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CommercialFollowUpService } from './commercial-followup.service';
import { ContactPreferenceService } from './contact-preference.service';
import { FinancingNoticeService } from './financing-notice.service';
import { SimulatedFinancingNoticeAdapter } from './simulated-financing-notice.adapter';
import { financingTestPrisma } from './testing/financing-test-harness';

const enabled = !!process.env.TEST_DATABASE_URL;

(enabled ? describe : describe.skip)(
  'Messaging MVP Integration — Spec 022 (US1, US2, US3)',
  () => {
    const prisma = enabled ? financingTestPrisma() : null!;
    const config = new ConfigService({
      FINANCING_NOTICE_TRANSPORT: 'simulated',
    });

    let contactPref: ContactPreferenceService;
    let notices: FinancingNoticeService;
    let followUp: CommercialFollowUpService;

    beforeAll(() => {
      const adapter = new SimulatedFinancingNoticeAdapter();
      contactPref = new ContactPreferenceService(prisma as any);
      notices = new FinancingNoticeService(prisma as any, config, adapter);
      followUp = new CommercialFollowUpService(prisma as any, config, notices);
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      await prisma.commercialFollowUpRule.upsert({
        where: { id: 'default' },
        create: {
          id: 'default',
          enabled: false,
          inactivityHours: 48,
          version: 1,
        },
        update: {
          enabled: false,
          inactivityHours: 48,
          version: 1,
          effectiveSince: null,
        },
      });
    });

    it('US1 (SC-001, FR-001..004): una baja explícita bloquea avisos de 020 y seguimientos de 021 para ese teléfono, y la reactivación conserva el historial sin revivir cupos consumidos', async () => {
      const phone = `+5493764${Math.floor(100000 + Math.random() * 900000)}`;
      const client = await prisma.client.create({
        data: { name: 'Cliente Baja 022', phone },
      });
      const conv = await prisma.conversation.create({
        data: {
          externalId: phone,
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          userType: 'CLIENTE',
        },
      });
      const oldAt = new Date(Date.now() - 72 * 3600 * 1000);
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: 'USER',
          content: 'Consulta inicial',
          createdAt: oldAt,
        },
      });
      const prospect = await prisma.prospect.create({
        data: {
          phone,
          name: 'Cliente Baja 022',
          productInterest: 'Horno Pizero 12 Moldes',
          status: 'EN_CONTACTO',
          conversationId: conv.id,
          createdAt: oldAt,
        },
      });
      const req = await prisma.purchaseRequest.create({
        data: {
          clientId: client.id,
          prospectId: prospect.id,
          conversationId: conv.id,
          productSummary: 'Horno Pizero 12 Moldes',
          amount: 500000,
          modality: 'FINANCED',
          status: 'APPROVED',
          commercialFlow: {
            version: 2,
            stage: 'CHOOSING',
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            offers: [{ id: 'cash-1', modality: 'CASH', totalAmount: '500000' }],
          },
        },
      });
      const pendingNotice = await prisma.outboundCommunication.create({
        data: {
          purpose: 'FINANCING_DECISION',
          dedupeKey: `decision:${req.id}:1`,
          purchaseRequestId: req.id,
          conversationId: conv.id,
          body: 'Tus opciones aprobadas están listas.',
          status: 'PENDING',
          transportMode: 'simulated',
        },
      });

      // Registrar baja explícita del contacto
      const optOutResult = await contactPref.recordOptOut({
        phone,
        reason: 'BAJA',
        sourceMessageId: 'msg-baja-022',
        sourceConversationId: conv.id,
      });

      expect(optOutResult.optOut).toBe(true);
      expect(optOutResult.history).toHaveLength(1);
      expect(optOutResult.history[0].action).toBe('OPT_OUT');

      // El aviso pendiente de 020 quedó detenido con CONTACT_OPT_OUT y no se envía
      await notices.dispatch(pendingNotice.id);
      const afterDispatch = await prisma.outboundCommunication.findUniqueOrThrow(
        { where: { id: pendingNotice.id } },
      );
      expect(afterDispatch.status).toBe('FAILED');
      expect(afterDispatch.lastErrorCode).toBe('CONTACT_OPT_OUT');
      expect(afterDispatch.attemptCount).toBe(0);

      // Aunque se active la regla de 021, el seguimiento del teléfono sigue bloqueado por CONTACT_OPT_OUT
      const rule = await followUp.getRule();
      await followUp.updateRule(
        { enabled: true, inactivityHours: 48, expectedVersion: rule.version },
        'sup-general-1',
      );
      const followUpStatus = await followUp.simulateDue(prospect.id);
      expect(followUpStatus.status).toBe('BLOCKED');
      expect(followUpStatus.reasonCode).toBe('CONTACT_OPT_OUT');

      // Reactivación confirmada por supervisión general con evidencia
      const reactivated = await contactPref.reactivate({
        phone,
        reason: 'El cliente pidió expresamente volver a recibir avisos',
        sourceMessageId: 'msg-alta-022',
        sourceConversationId: conv.id,
        actorId: 'sup-general-1',
      });
      expect(reactivated.optOut).toBe(false);
      expect(reactivated.history).toHaveLength(2);
      expect(reactivated.history[0].action).toBe('OPT_OUT');
      expect(reactivated.history[1].action).toBe('REACTIVATED');
    });

    it('US2 (SC-002, SC-003, FR-005..007): distingue ACCEPTED de DELIVERED y procesa confirmaciones repetidas de forma idempotente sin retroceder estado', async () => {
      const phone = `+5493764${Math.floor(100000 + Math.random() * 900000)}`;
      const client = await prisma.client.create({
        data: { name: 'Cliente Entrega 022', phone },
      });
      const conv = await prisma.conversation.create({
        data: {
          externalId: phone,
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          userType: 'CLIENTE',
        },
      });
      const req = await prisma.purchaseRequest.create({
        data: {
          clientId: client.id,
          conversationId: conv.id,
          productSummary: 'Amasadora 20 Kg',
          amount: 650000,
          modality: 'FINANCED',
          status: 'APPROVED',
          commercialFlow: {
            version: 2,
            stage: 'CHOOSING',
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            offers: [{ id: 'cash-1', modality: 'CASH', totalAmount: '650000' }],
          },
        },
      });
      const notice = await prisma.outboundCommunication.create({
        data: {
          purpose: 'FINANCING_DECISION',
          dedupeKey: `decision:${req.id}:1`,
          purchaseRequestId: req.id,
          conversationId: conv.id,
          body: 'Opciones disponibles para Amasadora 20 Kg.',
          status: 'PENDING',
          transportMode: 'simulated',
        },
      });

      // 1. Al despachar en modo simulado, pasa a ACCEPTED (no DELIVERED)
      await notices.dispatch(notice.id);
      const accepted = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.acceptedAt).not.toBeNull();
      expect(accepted.deliveredAt).toBeNull();
      expect(accepted.providerMessageId).toMatch(/^sim:/);

      // 2. Confirmación con providerMessageId incorrecto se rechaza sin alterar el aviso
      await expect(
        notices.confirmDelivery(notice.id, {
          providerMessageId: 'sim:otro-mensaje-inexistente',
        }),
      ).rejects.toThrow();

      // 3. Confirmación válida pasa a DELIVERED con fecha y procedencia simulada
      const delivered = await notices.confirmDelivery(notice.id, {
        providerMessageId: accepted.providerMessageId!,
        source: 'simulated',
      });
      expect(delivered.status).toBe('DELIVERED');
      expect(delivered.deliveredAt).not.toBeNull();
      expect(delivered.deliverySource).toBe('simulated');

      // 4. Confirmación repetida es idempotente: no cambia deliveredAt ni versión
      const duplicate = await notices.confirmDelivery(notice.id, {
        providerMessageId: accepted.providerMessageId!,
        source: 'simulated',
      });
      expect(duplicate.status).toBe('DELIVERED');
      expect(duplicate.version).toBe(delivered.version);
      expect(duplicate.deliveredAt).toEqual(delivered.deliveredAt);
    });

    it('US3 (SC-004, SC-005, FR-008..010): limita reintentos a 3 intentos técnicos totales y bloquea reintentar si la oferta de 020 venció o cambió', async () => {
      const phone = `+5493764${Math.floor(100000 + Math.random() * 900000)}`;
      const client = await prisma.client.create({
        data: { name: 'Cliente Reintento 022', phone },
      });
      const conv = await prisma.conversation.create({
        data: {
          externalId: phone,
          channel: 'WHATSAPP',
          status: 'ACTIVE',
          userType: 'CLIENTE',
        },
      });
      const req = await prisma.purchaseRequest.create({
        data: {
          clientId: client.id,
          conversationId: conv.id,
          productSummary: 'Cortadora de Fiambre 330',
          amount: 420000,
          modality: 'FINANCED',
          status: 'APPROVED',
          commercialFlow: {
            version: 2,
            stage: 'CHOOSING',
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            offers: [{ id: 'cash-1', modality: 'CASH', totalAmount: '420000' }],
          },
        },
      });
      const notice = await prisma.outboundCommunication.create({
        data: {
          purpose: 'FINANCING_DECISION',
          dedupeKey: `decision:${req.id}:1`,
          purchaseRequestId: req.id,
          conversationId: conv.id,
          body: 'Opciones disponibles para Cortadora 330.',
          status: 'PENDING',
          transportMode: 'simulated',
        },
      });

      const failingService = new FinancingNoticeService(prisma as any, config, {
        send: async () => ({ kind: 'NOT_ACCEPTED', code: 'TEMP_ERROR' }),
      } as any);

      // Intento 1 -> FAILED
      await failingService.dispatch(notice.id);
      const after1 = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(after1.status).toBe('FAILED');
      expect(after1.attemptCount).toBe(1);

      // Intento 2 -> FAILED
      const retry2 = await failingService.retry(
        notice.id,
        after1.version,
        'actor-1',
      );
      expect(retry2.status).toBe('PENDING');
      await failingService.dispatch(notice.id);
      const after2 = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(after2.status).toBe('FAILED');
      expect(after2.attemptCount).toBe(2);

      // Intento 3 -> FAILED
      await failingService.retry(notice.id, after2.version, 'actor-1');
      await failingService.dispatch(notice.id);
      const after3 = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(after3.status).toBe('FAILED');
      expect(after3.attemptCount).toBe(3);

      // Intento 4 -> rechazado por tope máximo de 3 intentos (MAX_ATTEMPTS_REACHED)
      await expect(
        failingService.retry(notice.id, after3.version, 'actor-1'),
      ).rejects.toThrow();
      const afterMax = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(afterMax.lastErrorCode).toBe('MAX_ATTEMPTS_REACHED');

      // Además, si en otro aviso con < 3 intentos vence la oferta de 020, el reintento se bloquea sin alterar la solicitud
      const reqExpired = await prisma.purchaseRequest.create({
        data: {
          clientId: client.id,
          conversationId: conv.id,
          productSummary: 'Freidora Doble',
          amount: 310000,
          modality: 'FINANCED',
          status: 'APPROVED',
          commercialFlow: {
            version: 2,
            stage: 'CHOOSING',
            expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
            offers: [{ id: 'cash-1', modality: 'CASH', totalAmount: '310000' }],
          },
        },
      });
      const expiredNotice = await prisma.outboundCommunication.create({
        data: {
          purpose: 'FINANCING_DECISION',
          dedupeKey: `decision:${reqExpired.id}:${randomUUID()}`,
          purchaseRequestId: reqExpired.id,
          conversationId: conv.id,
          body: 'Oferta vencida.',
          status: 'FAILED',
          attemptCount: 1,
          transportMode: 'simulated',
        },
      });

      await expect(
        failingService.retry(expiredNotice.id, expiredNotice.version, 'actor-1'),
      ).rejects.toThrow();
      const blockedExpired =
        await prisma.outboundCommunication.findUniqueOrThrow({
          where: { id: expiredNotice.id },
        });
      expect(blockedExpired.status).toBe('FAILED');
      expect(blockedExpired.lastErrorCode).toBe('CONDITIONS_CHANGED');
    });
  },
);
