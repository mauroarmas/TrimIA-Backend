import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { financingTestPrisma } from './testing/financing-test-harness';
import { FinancingService } from './financing.service';
import { CommercialFlowService } from './commercial-flow.service';
import { FinancingEvaluationService } from './financing-evaluation.service';
import { MockCreditAdapter } from '../ai/integrations/adapters/mock-credit.adapter';
import { MockStockAdapter } from '../ai/integrations/adapters/mock-stock.adapter';
import { OFFER_VALIDITY_MS } from './commercial-flow';
import { SalesService } from '../sales/sales.service';
import { FinancingConversationService } from './financing-conversation.service';

const enabled = !!process.env.TEST_DATABASE_URL;
(enabled ? describe : describe.skip)('recorrido comercial aislado', () => {
  const prisma = enabled ? financingTestPrisma() : null!;
  const stock = new MockStockAdapter();
  const commercial = new CommercialFlowService(prisma as any, stock);
  const financing = new FinancingService(
    prisma as any,
    new ConfigService({}),
    stock,
    commercial,
  );
  const evaluation = new FinancingEvaluationService(
    prisma as any,
    new MockCreditAdapter(),
  );
  let actor: string;
  let collector: string;
  beforeAll(async () => {
    const sector = await prisma.sector.create({
      data: { name: 'Comercial QA ' + randomUUID(), agentType: 'SALES' },
    });
    actor = (
      await prisma.employee.create({
        data: {
          name: 'QA comercial',
          email: randomUUID() + '@example.invalid',
          phone: randomUUID(),
          password: 'unused',
          sectorId: sector.id,
        },
      })
    ).id;
    const collections =
      (await prisma.sector.findFirst({ where: { name: 'Cobranzas' } })) ??
      (await prisma.sector.create({
        data: { name: 'Cobranzas', agentType: 'COLLECTIONS' },
      }));
    collector = (
      await prisma.employee.create({
        data: {
          name: 'Cobrador QA',
          email: randomUUID() + '@example.invalid',
          phone: randomUUID(),
          password: 'unused',
          sectorId: collections.id,
        },
      })
    ).id;
  });
  afterAll(() => prisma.$disconnect());
  const firstDate = () =>
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  async function start() {
    const conversation = await prisma.conversation.create({
      data: {
        externalId:
          '549' +
          String(Date.now()).slice(-10) +
          String(Math.floor(Math.random() * 100)).padStart(2, '0'),
        channel: 'WEB',
      },
    });
    const response = await financing.applyInput(conversation.id, randomUUID(), {
      intent: 'REQUEST',
      flowVersion: 2,
      name: 'Cliente QA',
      dni: '30000008',
      productSummary: 'Cortadora Berkley 300mm',
      sku: 'COR-BER-300',
      business: 'Almacén QA',
      locality: 'Posadas',
    });
    const request = await prisma.purchaseRequest.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    await evaluation.evaluate(request.id, request.version);
    return { conversation, request, response };
  }
  async function approve(
    id: string,
    decision: 'APPROVED' | 'REJECTED' = 'APPROVED',
  ) {
    const row = await commercial.commercial(id);
    await commercial.review(
      id,
      {
        expectedVersion: row.version,
        decision,
        offerIds: decision === 'APPROVED' ? ['cash', 'weekly-12'] : ['cash'],
        collectorId: collector,
        firstDueDate: firstDate(),
        note: 'Revisión humana ficticia',
      },
      actor,
    );
  }
  async function choose(id: string, choice = '12 cuotas') {
    await commercial.customerMessage(id, randomUUID(), choice);
    const summary = await commercial.customerMessage(
      id,
      randomUUID(),
      'retiro en sucursal',
    );
    await commercial.customerMessage(id, randomUUID(), 'Sí, confirmo');
    return summary;
  }
  it('conserva nombre al pedir modelos y precio; elegir Berkley continúa sin escalado', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        externalId: '549' + String(Date.now()).slice(-10) + '88',
        channel: 'WEB',
      },
    });
    const invoke = jest.fn();
    const escalate = jest.fn();
    const handler = new FinancingConversationService(
      prisma as any,
      { classifierChat: { withStructuredOutput: () => ({ invoke }) } } as any,
      financing,
      { create: escalate } as any,
      commercial,
      stock,
    );
    const caller = { userType: 'CLIENTE' } as any;
    invoke.mockResolvedValueOnce({
      intent: 'REQUEST',
      sku: { value: '44581626', evidence: '44581626' },
      productSummary: {
        value: 'cortadora de fiambre',
        evidence: 'cortadora de fiambre',
      },
      dni: { value: '44581626', evidence: '44581626' },
    });
    await handler.handle(
      conversation.id,
      randomUUID(),
      'Quiero financiar una cortadora de fiambre, DNI 44581626',
      caller,
    );
    invoke.mockResolvedValueOnce({
      intent: 'INFORMATION',
      name: { value: 'Martín Iturre', evidence: 'Martín Iturre' },
    });
    const catalogResponse = await handler.handle(
      conversation.id,
      randomUUID(),
      'decime los modelos disponibles con precio, mi nombre es Martín Iturre',
      caller,
    );
    expect(catalogResponse.response).toMatch(/Berkley/);
    expect((await financing.getDraft(conversation.id)).name).toBe(
      'Martín Iturre',
    );
    invoke.mockResolvedValueOnce({
      intent: 'PROVIDE_DATA',
      productSummary: { value: 'Berkley 300 mm', evidence: 'Berkley 300 mm' },
    });
    await handler.handle(
      conversation.id,
      randomUUID(),
      'quiero la Berkley 300 mm',
      caller,
    );
    invoke.mockResolvedValueOnce({
      intent: 'PROVIDE_DATA',
      business: { value: 'Almacén Iturre', evidence: 'Almacén Iturre' },
      locality: { value: 'Posadas', evidence: 'Posadas' },
    });
    const done = await handler.handle(
      conversation.id,
      randomUUID(),
      'Mi comercio es Almacén Iturre, localidad Posadas',
      caller,
    );
    expect(done.response).toMatch(/creamos el pedido/);
    expect(escalate).not.toHaveBeenCalled();
    const row = await prisma.purchaseRequest.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    expect(row.commercialFlow).toBeTruthy();
  });
  it('crea pedido completo sin confirmación inicial ni escalado, con 48 horas desde la creación', async () => {
    const { conversation, request, response } = await start();
    expect(response.response).toMatch(/Administración/);
    const row = await commercial.commercial(request.id);
    expect(row.flow.stage).toBe('REVIEW');
    expect(
      Date.parse(row.flow.expiresAt) - Date.parse(row.flow.startedAt),
    ).toBe(OFFER_VALIDITY_MS);
    expect(
      Math.abs(Date.parse(row.flow.startedAt) - request.createdAt.getTime()),
    ).toBeLessThan(1000);
    expect(
      await prisma.escalation.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(0);
    expect(row.business).toBe('Almacén QA');
  });
  it('no presenta antes de recopilar comercio y localidad', async () => {
    const c = await prisma.conversation.create({
      data: {
        externalId: '549' + String(Date.now()).slice(-10),
        channel: 'WEB',
      },
    });
    await financing.applyInput(c.id, randomUUID(), {
      intent: 'REQUEST',
      flowVersion: 2,
      name: 'QA',
      dni: '30000008',
      sku: 'COR-BER-300',
      productSummary: 'Berkley',
    });
    expect((await financing.getDraft(c.id)).missingFields).toEqual([
      'business',
      'locality',
    ]);
    expect(
      await prisma.purchaseRequest.count({ where: { conversationId: c.id } }),
    ).toBe(0);
  });
  it('cierra y registra exactamente un plan ante dos cierres concurrentes', async () => {
    const { request } = await start();
    await approve(request.id);
    expect(
      await prisma.financing.count({
        where: { purchaseRequestId: request.id },
      }),
    ).toBe(0);
    const summary = await choose(request.id);
    expect(summary.response).toMatch(/Resumen del pedido/);
    const row = await commercial.commercial(request.id);
    expect(row.flow.stage).toBe('READY');
    const dto = {
      expectedVersion: row.version,
      reference: 'Venta ficticia acordada',
    };
    const results = await Promise.all([
      commercial.close(request.id, dto, actor),
      commercial.close(request.id, dto, actor),
    ]);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    const closed = await commercial.commercial(request.id);
    expect(closed.financing?.quotas).toHaveLength(12);
    expect(
      closed.financing?.quotas.reduce((sum, q) => sum + Number(q.amount), 0),
    ).toBeCloseTo(610000, 2);
    expect(closed.closedAt).toBeTruthy();
    expect(
      await prisma.outboundCommunication.count({
        where: { dedupeKey: `commercial-close:${request.id}` },
      }),
    ).toBe(1);
  });
  it('rechazo permite contado habilitado sin crear cuotas ni filtrar dictamen', async () => {
    const { request } = await start();
    await approve(request.id, 'REJECTED');
    await choose(request.id, 'contado');
    const row = await commercial.commercial(request.id);
    await commercial.close(
      request.id,
      { expectedVersion: row.version, reference: 'Contado QA' },
      actor,
    );
    const closed = await commercial.commercial(request.id);
    expect(closed.closedAt).toBeTruthy();
    expect(closed.financing).toBeNull();
    const messages = await prisma.outboundCommunication.findMany({
      where: { purchaseRequestId: request.id },
    });
    expect(messages.map((m) => m.body).join(' ')).not.toMatch(
      /score|deuda|BCRA|Revisión humana/i,
    );
  });
  it('no acepta seleccionar una opción no habilitada', async () => {
    const { request } = await start();
    await approve(request.id);
    await commercial.customerMessage(request.id, randomUUID(), '24 cuotas');
    expect(
      (await commercial.commercial(request.id)).flow.selectedOfferId,
    ).toBeUndefined();
  });
  it('no cierra sin aceptación explícita del resumen', async () => {
    const { request } = await start();
    await approve(request.id);
    const row = await commercial.commercial(request.id);
    await expect(
      commercial.close(
        request.id,
        { expectedVersion: row.version, reference: 'QA' },
        actor,
      ),
    ).rejects.toThrow(/aceptación/);
    expect(
      await prisma.financing.count({
        where: { purchaseRequestId: request.id },
      }),
    ).toBe(0);
  });
  it('vencer devuelve a Administración y renovar reinicia explícitamente el período y la evaluación', async () => {
    const { request } = await start();
    await approve(request.id);
    await choose(request.id);
    const row = await commercial.commercial(request.id);
    await prisma.purchaseRequest.update({
      where: { id: request.id },
      data: {
        commercialFlow: {
          ...row.flow,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    await expect(
      commercial.close(
        request.id,
        { expectedVersion: row.version, reference: 'QA' },
        actor,
      ),
    ).rejects.toThrow();
    const expired = await commercial.commercial(request.id);
    expect(expired.status).toBe('PENDING_REVIEW');
    expect(expired.flow.acceptedRevision).toBeUndefined();
    await commercial.renew(request.id, expired.version, actor);
    const renewed = await commercial.commercial(request.id);
    expect(renewed.expired).toBe(false);
    expect(renewed.flow.offers).toEqual([]);
    expect(
      (
        await prisma.purchaseRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).evaluationState,
    ).toBe('PENDING');
  });
  it('editar entrega invalida aceptación y conserva aprobación', async () => {
    const { request } = await start();
    await approve(request.id);
    await choose(request.id);
    const row = await commercial.commercial(request.id);
    const changed = await commercial.edit(
      request.id,
      {
        expectedVersion: row.version,
        deliveryMode: 'SHIPPING',
        deliveryAddress: 'Calle QA 123',
      },
      actor,
    );
    expect(changed.status).toBe('APPROVED');
    expect(changed.flow.stage).toBe('CHOOSING');
    expect(changed.flow.acceptedRevision).toBeUndefined();
    await expect(
      commercial.close(
        request.id,
        { expectedVersion: changed.version, reference: 'QA' },
        actor,
      ),
    ).rejects.toThrow();
    await commercial.customerMessage(request.id, randomUUID(), 'cómo seguimos');
    await commercial.customerMessage(request.id, randomUUID(), 'Sí, confirmo');
    const confirmed = await commercial.commercial(request.id);
    expect(confirmed.flow.stage).toBe('READY');
    expect(confirmed.flow.shippingCost).toBe('15000.00');
  });
  it('editar producto devuelve a revisión sin duplicar pedido', async () => {
    const { request } = await start();
    await approve(request.id);
    const row = await commercial.commercial(request.id);
    const changed = await commercial.edit(
      request.id,
      { expectedVersion: row.version, sku: 'COR-TRI-300' },
      actor,
    );
    expect(changed.status).toBe('PENDING_REVIEW');
    expect(changed.sku).toBe('COR-TRI-300');
    expect(changed.flow.offers).toEqual([]);
  });
  it('cambio de precio o falta de stock bloquean y persisten revisión', async () => {
    const { request } = await start();
    await approve(request.id);
    const method = jest.spyOn(stock, 'checkAvailability');
    const real = await stock.checkAvailability('COR-BER-300');
    method.mockResolvedValueOnce({
      ...real,
      item: { ...real.item, listPrice: 620000 },
    });
    await commercial.revalidate(request.id);
    method.mockRestore();
    expect((await commercial.commercial(request.id)).flow.stage).toBe('REVIEW');
  });
  it('el endpoint anterior no permite cerrar un pedido nuevo por solicitud ni prospecto', async () => {
    const { request } = await start();
    await approve(request.id);
    const sales = new SalesService({} as any, stock, prisma as any);
    await expect(
      sales.closeSale(
        {
          purchaseRequestId: request.id,
          modality: 'FINANCED',
          finalAmount: 610000,
          notes: 'QA',
        },
        actor,
      ),
    ).rejects.toThrow(/unificado/);
    await expect(
      sales.closeSale(
        {
          prospectId: request.prospectId!,
          modality: 'FINANCED',
          finalAmount: 610000,
          notes: 'QA',
        },
        actor,
      ),
    ).rejects.toThrow(/unificado/);
  });
  it('un pedido cancelado no puede cerrarse aunque hubiera aceptado contado', async () => {
    const { request } = await start();
    await approve(request.id, 'REJECTED');
    await choose(request.id, 'contado');
    const row = await commercial.commercial(request.id);
    await commercial.cancelFromCustomer(request.id, row.version, randomUUID());
    const cancelled = await commercial.commercial(request.id);
    await expect(
      commercial.close(
        request.id,
        { expectedVersion: cancelled.version, reference: 'QA' },
        actor,
      ),
    ).rejects.toThrow(/cancelado/);
    expect(cancelled.closedAt).toBeNull();
    expect(cancelled.financing).toBeNull();
  });
  it('respeta intervención humana al recibir una selección', async () => {
    const { request, conversation } = await start();
    await approve(request.id);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'HUMAN_HANDLING', handledById: actor },
    });
    const result = await commercial.customerMessage(
      request.id,
      randomUUID(),
      '12 cuotas',
    );
    expect(result).toEqual({ handled: true });
    expect(
      (await commercial.commercial(request.id)).flow.selectedOfferId,
    ).toBeUndefined();
  });
});
