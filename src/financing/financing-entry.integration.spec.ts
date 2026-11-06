import { SalesService } from '../sales/sales.service';
import { financingCustomerFixture } from './testing/financing.fixtures';
import { ConfigService } from '@nestjs/config';
import { financingTestPrisma } from './testing/financing-test-harness';
import { FinancingService } from './financing.service';
import { FinancingEvaluationService } from './financing-evaluation.service';
import { FinancingNoticeService } from './financing-notice.service';
import { MockCreditAdapter } from '../ai/integrations/adapters/mock-credit.adapter';
import { SimulatedFinancingNoticeAdapter } from './simulated-financing-notice.adapter';
import { randomUUID } from 'crypto';
const enabled = !!process.env.TEST_DATABASE_URL;
(enabled ? describe : describe.skip)(
  'financing isolated postgres workflow',
  () => {
    const prisma = enabled ? financingTestPrisma() : null!;
    const config = new ConfigService({
      FINANCING_NOTICE_TRANSPORT: 'simulated',
    });
    const stock = { listCatalog: async () => [], checkAvailability: jest.fn() };
    const service = new FinancingService(prisma as any, config, stock as any);
    const evaluate = new FinancingEvaluationService(
      prisma as any,
      new MockCreditAdapter(),
    );
    const adapter = new SimulatedFinancingNoticeAdapter();
    const notices = new FinancingNoticeService(prisma as any, config, adapter);
    let supervisor: string;
    let collector: string;
    async function start(
      dni = '30000008',
      channel: 'WHATSAPP' | 'WEB' = 'WHATSAPP',
    ) {
      const phone =
        '549' +
        String(Date.now()).slice(-10) +
        String(Math.floor(Math.random() * 10));
      const conv = await prisma.conversation.create({
        data: { externalId: phone, channel },
      });
      await service.applyInput(conv.id, randomUUID(), {
        intent: 'REQUEST',
        ...financingCustomerFixture,
        dni,
      });
      let draft = await service.getDraft(conv.id);
      await service.updateDraft(
        conv.id,
        {
          expectedVersion: draft.version,
          confirmedAmount: '100000.00',
          note: 'Precio de prueba confirmado',
        },
        supervisor,
      );
      await service.applyInput(conv.id, randomUUID(), {
        intent: 'PROVIDE_DATA',
      });
      draft = await service.getDraft(conv.id);
      const messageId = randomUUID();
      await service.applyInput(conv.id, messageId, { intent: 'CONFIRM' });
      const req = await prisma.purchaseRequest.findFirstOrThrow({
        where: { conversationId: conv.id },
      });
      await evaluate.evaluate(req.id, req.version);
      return {
        conv,
        req: await prisma.purchaseRequest.findUniqueOrThrow({
          where: { id: req.id },
        }),
        messageId,
      };
    }
    it('completa desde WEB la confirmación, revisión y aviso simulado en el mismo hilo', async () => {
      const { conv, req } = await start('30000008', 'WEB');
      await service.review(
        req.id,
        {
          expectedVersion: req.version,
          decision: 'APPROVED',
          note: 'Revisión humana del simulador',
        },
        supervisor,
      );
      const notice = await prisma.outboundCommunication.findFirstOrThrow({
        where: { purchaseRequestId: req.id },
      });
      await notices.dispatch(notice.id);
      const sent = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(sent.status).toBe('ACCEPTED');
      expect(sent.transportMode).toBe('simulated');
      expect(sent.conversationId).toBe(conv.id);
      expect(
        await prisma.financing.count({ where: { purchaseRequestId: req.id } }),
      ).toBe(0);
    });
    beforeAll(async () => {
      const sector = await prisma.sector.create({
        data: { name: 'Admin ' + randomUUID(), agentType: 'ADMIN' },
      });
      const employee = await prisma.employee.create({
        data: {
          name: 'Supervisor de prueba',
          email: randomUUID() + '@example.invalid',
          phone: randomUUID(),
          password: 'unused',
          role: 'SUPERVISOR',
          sectorId: sector.id,
        },
      });
      supervisor = employee.id;
      const collectionSector =
        (await prisma.sector.findFirst({ where: { name: 'Cobranzas' } })) ??
        (await prisma.sector.create({
          data: { name: 'Cobranzas', agentType: 'COLLECTIONS' },
        }));
      collector = (
        await prisma.employee.create({
          data: {
            name: 'Cobrador de prueba',
            email: randomUUID() + '@example.invalid',
            phone: randomUUID(),
            password: 'unused',
            role: 'EMPLEADO',
            sectorId: collectionSector.id,
          },
        })
      ).id;
    });
    afterAll(async () => prisma.$disconnect());
    it.each([
      ['30000008', 'APPROVED'],
      ['30000004', 'APPROVED_WITH_CONDITIONS'],
      ['30000001', 'REJECTED'],
      ['00000000', 'UNAVAILABLE'],
    ])('presenta %s para humano con %s', async (dni, verdict) => {
      const { req } = await start(dni);
      expect(req.status).toBe('PENDING_REVIEW');
      expect(req.evaluationState).toBe('READY');
      expect(
        (
          await prisma.creditAssessment.findFirstOrThrow({
            where: { purchaseRequestId: req.id },
          })
        ).verdict,
      ).toBe(verdict);
      expect(
        await prisma.financing.count({ where: { purchaseRequestId: req.id } }),
      ).toBe(0);
    });
    it('registra una sola financiación y sus cuotas después de cerrar, incluso con altas concurrentes', async () => {
      const { req } = await start();
      const approved = await service.review(
        req.id,
        {
          expectedVersion: req.version,
          decision: 'APPROVED',
          note: 'Aprobación de prueba',
        },
        supervisor,
      );
      const sales = new SalesService(null, null, prisma as any);
      await sales.closeSale(
        {
          purchaseRequestId: req.id,
          modality: 'FINANCED',
          finalAmount: 100000,
          notes: 'Cierre de prueba',
        },
        supervisor,
      );
      const dto = {
        expectedVersion: approved.version,
        quotaCount: 12,
        firstDueDate: '2026-11-13',
        collectorId: collector,
        note: '12 cuotas semanales acordadas',
      };
      const [a, b] = await Promise.all([
        service.createPlan(req.id, dto, supervisor),
        service.createPlan(req.id, dto, supervisor),
      ]);
      expect(a.id).toBe(b.id);
      expect(a.quotas).toHaveLength(12);
      expect(
        a.quotas.reduce(
          (sum, q) => sum + Math.round(Number(q.amount) * 100),
          0,
        ),
      ).toBe(10000000);
      expect(new Set(a.quotas.map((q) => q.clientId))).toEqual(
        new Set([req.clientId]),
      );
      expect(
        (await prisma.client.findUniqueOrThrow({ where: { id: req.clientId } }))
          .assignedCollectorId,
      ).toBe(collector);
      expect(
        await prisma.orchestrationEvent.count({
          where: {
            eventType: 'FINANCING_PLAN_CREATED',
            payload: { path: ['requestId'], equals: req.id },
          },
        }),
      ).toBe(1);
      await expect(
        service.createPlan(req.id, { ...dto, quotaCount: 10 }, supervisor),
      ).rejects.toThrow();
      expect(await prisma.quota.count({ where: { financingId: a.id } })).toBe(
        12,
      );
    });
    it('no genera cuotas al aprobar sin cierre ni con un cobrador no habilitado', async () => {
      const { req } = await start();
      const approved = await service.review(
        req.id,
        { expectedVersion: req.version, decision: 'APPROVED', note: 'Prueba' },
        supervisor,
      );
      const dto = {
        expectedVersion: approved.version,
        quotaCount: 12,
        firstDueDate: '2026-11-13',
        collectorId: collector,
        note: 'Prueba de permisos',
      };
      await expect(
        service.createPlan(req.id, dto, supervisor),
      ).rejects.toThrow();
      await prisma.purchaseRequest.update({
        where: { id: req.id },
        data: { closedAt: new Date() },
      });
      await expect(
        service.createPlan(
          req.id,
          { ...dto, collectorId: supervisor },
          supervisor,
        ),
      ).rejects.toThrow();
      await expect(
        service.createPlan(req.id, { ...dto, expectedVersion: 0 }, supervisor),
      ).rejects.toThrow();
      expect(
        await prisma.financing.count({ where: { purchaseRequestId: req.id } }),
      ).toBe(0);
    });
    it('no reasigna la cartera de un cliente al dar de alta un plan', async () => {
      const { req } = await start();
      const approved = await service.review(
        req.id,
        { expectedVersion: req.version, decision: 'APPROVED', note: 'Prueba' },
        supervisor,
      );
      await prisma.purchaseRequest.update({
        where: { id: req.id },
        data: { closedAt: new Date() },
      });
      await prisma.client.update({
        where: { id: req.clientId },
        data: { assignedCollectorId: supervisor },
      });
      await expect(
        service.createPlan(
          req.id,
          {
            expectedVersion: approved.version,
            quotaCount: 12,
            firstDueDate: '2026-11-13',
            collectorId: collector,
            note: 'Prueba',
          },
          supervisor,
        ),
      ).rejects.toThrow();
      expect(
        (await prisma.client.findUniqueOrThrow({ where: { id: req.clientId } }))
          .assignedCollectorId,
      ).toBe(supervisor);
    });
    it('reenvío de confirmación conserva un caso', async () => {
      const { conv, req, messageId } = await start();
      await service.applyInput(conv.id, messageId, { intent: 'CONFIRM' });
      expect(
        await prisma.purchaseRequest.count({
          where: { conversationId: conv.id },
        }),
      ).toBe(1);
      expect((await service.getDraft(conv.id)).purchaseRequestId).toBe(req.id);
    });
    it('dos supervisores no deciden dos veces', async () => {
      const { req } = await start();
      const results = await Promise.allSettled([
        service.review(
          req.id,
          { expectedVersion: req.version, decision: 'APPROVED' },
          supervisor,
        ),
        service.review(
          req.id,
          {
            expectedVersion: req.version,
            decision: 'REJECTED',
            note: 'Decisión humana',
          },
          supervisor,
        ),
      ]);
      expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.outboundCommunication.count({
          where: { purchaseRequestId: req.id },
        }),
      ).toBe(1);
    });
    it('nota obligatoria para condicional', async () => {
      const { req } = await start('30000004');
      await expect(
        service.review(
          req.id,
          { expectedVersion: req.version, decision: 'APPROVED' },
          supervisor,
        ),
      ).rejects.toThrow();
    });
    it('corrección cambia oportunidad, bloquea revisión vieja y conserva evaluación', async () => {
      const { req } = await start();
      await service.correct(
        req.id,
        {
          expectedVersion: req.version,
          name: 'Cliente Ficticio',
          dni: '30000004',
          productSummary: 'Producto corregido',
          amount: '200000.00',
          confirmData: true,
          note: 'Corrección humana',
        },
        supervisor,
      );
      const next = await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: req.id },
      });
      const prospect = await prisma.prospect.findUniqueOrThrow({
        where: { id: next.prospectId! },
      });
      expect(prospect.productInterest).toBe('Producto corregido');
      expect(prospect.estimatedAmount!.toString()).toBe('200000');
      expect(prospect.syncStatus).toBe('PENDING');
      await expect(
        service.review(
          req.id,
          { expectedVersion: req.version, decision: 'APPROVED' },
          supervisor,
        ),
      ).rejects.toThrow();
      await evaluate.evaluate(req.id, next.version);
      expect(
        await prisma.creditAssessment.count({
          where: { purchaseRequestId: req.id },
        }),
      ).toBe(2);
    });
    it('cancelación detiene revisión/evaluación y no crea aviso', async () => {
      const { req } = await start();
      await service.cancel(
        req.id,
        { expectedVersion: req.version },
        supervisor,
      );
      await expect(
        service.review(
          req.id,
          { expectedVersion: req.version, decision: 'APPROVED' },
          supervisor,
        ),
      ).rejects.toThrow();
      expect(
        await prisma.outboundCommunication.count({
          where: { purchaseRequestId: req.id },
        }),
      ).toBe(0);
    });
    it('aviso simulado independiente y sin cuotas', async () => {
      const { req } = await start();
      await service.review(
        req.id,
        {
          expectedVersion: req.version,
          decision: 'APPROVED',
          note: 'Nota privada no exportar',
        },
        supervisor,
      );
      const notice = await prisma.outboundCommunication.findFirstOrThrow({
        where: { purchaseRequestId: req.id },
      });
      await Promise.all([
        notices.dispatch(notice.id),
        notices.dispatch(notice.id),
      ]);
      const sent = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(sent.status).toBe('ACCEPTED');
      expect(sent.providerMessageId).toMatch(/^sim:/);
      expect(sent.attemptCount).toBe(1);
      expect(sent.body).not.toContain('Nota privada');
      expect(
        await prisma.financing.count({ where: { purchaseRequestId: req.id } }),
      ).toBe(0);
      await expect(
        notices.retry(sent.id, sent.version, supervisor),
      ).rejects.toThrow();
    });
    it('incertidumbre no admite reintento ciego', async () => {
      const { req } = await start();
      await service.review(
        req.id,
        { expectedVersion: req.version, decision: 'APPROVED' },
        supervisor,
      );
      const notice = await prisma.outboundCommunication.findFirstOrThrow({
        where: { purchaseRequestId: req.id },
      });
      const uncertain = new FinancingNoticeService(prisma as any, config, {
        send: async () => ({ kind: 'UNKNOWN' }),
      } as any);
      await uncertain.dispatch(notice.id);
      const result = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(result.status).toBe('UNCERTAIN');
      await expect(
        uncertain.retry(result.id, result.version, supervisor),
      ).rejects.toThrow();
    });
    it('fallo antes de commit revierte confirmación, caso y actionKey; retry recupera una vez', async () => {
      const conv = await prisma.conversation.create({
        data: {
          externalId: '5493815' + String(Date.now()).slice(-6),
          channel: 'WHATSAPP',
        },
      });
      await service.applyInput(conv.id, randomUUID(), {
        intent: 'REQUEST',
        ...financingCustomerFixture,
      });
      const draft = await service.getDraft(conv.id);
      await service.updateDraft(
        conv.id,
        {
          expectedVersion: draft.version,
          confirmedAmount: '100.00',
          note: 'Confirmación humana',
        },
        supervisor,
      );
      await service.applyInput(conv.id, randomUUID(), {
        intent: 'PROVIDE_DATA',
      });
      const messageId = randomUUID();
      const broken: any = {
        $transaction: (fn: any) =>
          prisma.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(target, key) {
                  if (key !== 'orchestrationEvent')
                    return target[key as keyof typeof target];
                  return {
                    ...target.orchestrationEvent,
                    create: async (args: any) => {
                      if (args.data.eventType === 'FINANCING_SUBMITTED')
                        throw Error('Antes del commit');
                      return target.orchestrationEvent.create(args);
                    },
                  };
                },
              }),
            ),
          ),
      };
      await expect(
        new FinancingService(broken, config, stock as any).applyInput(
          conv.id,
          messageId,
          { intent: 'CONFIRM' },
        ),
      ).rejects.toThrow('Antes del commit');
      expect(
        await prisma.purchaseRequest.count({
          where: { conversationId: conv.id },
        }),
      ).toBe(0);
      expect(
        await prisma.orchestrationEvent.findUnique({
          where: { actionKey: `financing:input:${messageId}` },
        }),
      ).toBeNull();
      expect((await service.getDraft(conv.id)).stage).toBe(
        'AWAITING_CONFIRMATION',
      );
      await service.applyInput(conv.id, messageId, { intent: 'CONFIRM' });
      const first = await prisma.purchaseRequest.findFirstOrThrow({
        where: { conversationId: conv.id },
      });
      await service.applyInput(conv.id, messageId, { intent: 'CONFIRM' });
      expect(
        await prisma.purchaseRequest.count({
          where: { conversationId: conv.id },
        }),
      ).toBe(1);
      expect((await service.getDraft(conv.id)).purchaseRequestId).toBe(
        first.id,
      );
    });
    it('no fusiona identidad incompatible ni autoriza el precio del cliente', async () => {
      const phone = '5493815' + String(Date.now()).slice(-6);
      await prisma.client.create({
        data: { name: 'Persona existente', dni: '30000001', phone },
      });
      const conv = await prisma.conversation.create({
        data: { externalId: phone, channel: 'WHATSAPP' },
      });
      await service.applyInput(conv.id, randomUUID(), {
        intent: 'REQUEST',
        ...financingCustomerFixture,
        observedAmount: '500.00',
      });
      expect((await service.getDraft(conv.id)).missingFields).toContain(
        'confirmedAmount',
      );
      await service.updateDraft(
        conv.id,
        {
          expectedVersion: (await service.getDraft(conv.id)).version,
          confirmedAmount: '100.00',
          note: 'Precio humano',
        },
        supervisor,
      );
      await service.applyInput(conv.id, randomUUID(), {
        intent: 'PROVIDE_DATA',
      });
      await service.applyInput(conv.id, randomUUID(), { intent: 'CONFIRM' });
      expect((await service.getDraft(conv.id)).stage).toBe('IDENTITY_CONFLICT');
      expect(
        await prisma.purchaseRequest.count({
          where: { conversationId: conv.id },
        }),
      ).toBe(0);
      expect(
        (await prisma.client.findUniqueOrThrow({ where: { phone } })).dni,
      ).toBe('30000001');
    });
    it('conserva trazabilidad de recopilación y no deja una confirmación vieja pisar corrección humana', async () => {
      const { req, conv } = await start();
      const history = await service.detail(req.id);
      expect(
        history.events.some((e) => e.eventType === 'FINANCING_DRAFT_UPDATED'),
      ).toBe(true);
      expect(JSON.stringify(history.events)).not.toMatch(
        /30000008|rawPayload|score/,
      );
      await service.correct(
        req.id,
        {
          expectedVersion: req.version,
          name: 'Cliente Ficticio',
          dni: '30000008',
          productSummary: 'Producto nuevo',
          amount: '250000.00',
          confirmData: true,
          note: 'Datos corregidos',
        },
        supervisor,
      );
      await service.applyInput(conv.id, randomUUID(), { intent: 'CONFIRM' });
      const current = await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: req.id },
      });
      expect(current.amount!.toString()).toBe('250000');
      expect(current.version).toBe(req.version + 1);
      const draft = await service.getDraft(conv.id);
      expect(draft.confirmedAmount).toBe('250000.00');
      expect(draft.stage).toBe('AWAITING_CONFIRMATION');
    });
    it('un cambio de precio de stock exige nuevo resumen antes de presentar', async () => {
      let price = 100;
      const priced = new FinancingService(prisma as any, config, {
        checkAvailability: async () => ({
          item: { sku: 'TEST-020', listPrice: price },
        }),
      } as any);
      const conv = await prisma.conversation.create({
        data: {
          externalId: '5493815' + String(Date.now()).slice(-6),
          channel: 'WHATSAPP',
        },
      });
      await priced.applyInput(conv.id, randomUUID(), {
        intent: 'REQUEST',
        ...financingCustomerFixture,
        sku: 'TEST-020',
      });
      price = 200;
      await priced.applyInput(conv.id, randomUUID(), {
        intent: 'CONFIRM',
        sku: 'TEST-020',
      });
      expect(
        await prisma.purchaseRequest.count({
          where: { conversationId: conv.id },
        }),
      ).toBe(0);
      expect((await priced.getDraft(conv.id)).confirmedAmount).toBe('200.00');
    });
  },
);
