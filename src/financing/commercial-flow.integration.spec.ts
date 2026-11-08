import { buildSalesGraph } from '../ai/agents/sales/sales.graph';
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
  it('recorre catálogo → modelo elegido → financiación → datos → Administración sin repetir opciones', async () => {
    const c = await prisma.conversation.create({
      data: {
        externalId: '549' + String(Date.now()).slice(-10) + '53',
        channel: 'WHATSAPP',
      },
    });
    const create = jest.fn();
    const llm: any = {
      classifierChat: {
        withStructuredOutput: () => ({
          invoke: async () => ({ intent: 'OTHER' }),
        }),
      },
      chat: {
        bindTools: () => ({
          invoke: async () => ({
            tool_calls: [{ name: 'check_stock', args: { query: 'heladeras' } }],
          }),
        }),
        withStructuredOutput: () => ({
          invoke: async () => ({
            parsed: { response: 'Lista', needsHuman: false },
            raw: {},
          }),
        }),
      },
    };
    const handler = new FinancingConversationService(
      prisma as any,
      llm,
      financing,
      { create } as any,
      commercial,
      stock,
    );
    const graph = buildSalesGraph({
      llm,
      stockPort: stock,
      knowledge: { search: async () => [] } as any,
      confidenceThreshold: 0.7,
      logger: { log() {}, warn() {} } as any,
      escalations: { create } as any,
    });
    const history: any[] = [];
    const turn = async (content: string) => {
      const message = await prisma.message.create({
        data: { conversationId: c.id, role: 'USER', content },
      });
      let result: any = await handler.handle(c.id, message.id, content, {
        userType: 'CLIENTE',
      } as any);
      if (!result.handled)
        result = await graph.invoke({
          message: content,
          conversationId: c.id,
          userType: 'CLIENTE',
          history,
        });
      expect(result.response).toBeTruthy();
      await prisma.message.create({
        data: {
          conversationId: c.id,
          role: 'ASSISTANT',
          content: result.response,
        },
      });
      history.push(
        { role: 'USER', content },
        { role: 'ASSISTANT', content: result.response },
      );
      return result.response as string;
    };
    expect(await turn('quisiera comprar una heladera')).toContain(
      '3. Heladera Exhibidora Inelro 600 Litros',
    );
    const selected = await turn(
      'quiero la Heladera Exhibidora Inelro 600 Litros',
    );
    expect(selected).toContain(
      'Elegiste Heladera Exhibidora Inelro 600 Litros',
    );
    expect(selected).not.toContain('Briket');
    expect(await turn('quiero financiación')).toMatch(/nombre.*DNI/);
    const submitted = await turn(
      'Nombre: Mauro Armas\nDNI: 90000001\nComercio: Almacén Mauro\nLocalidad: Posadas',
    );
    expect(submitted).toContain('creamos el pedido de financiación');
    const request = await prisma.purchaseRequest.findFirstOrThrow({
      where: { conversationId: c.id },
    });
    expect(request.status).toBe('PENDING_REVIEW');
    expect(request.productSummary).toContain('Inelro 600');
    expect(request.amount?.toString()).toBe('1180000');
    expect(
      await prisma.prospect.count({ where: { conversationId: c.id } }),
    ).toBe(1);
    expect(create).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'recuerda «es para financiación» y recopila datos sin prometer un pedido inexistente (personal: %s)',
    async (personal) => {
      const c = await prisma.conversation.create({
        data: {
          externalId: '549' + randomUUID().replace(/\D/g, '').slice(0, 10),
          channel: 'WHATSAPP',
        },
      });
      const invoke = jest
        .fn()
        .mockRejectedValue(new Error('extractor unavailable'));
      const create = jest.fn();
      const handler = new FinancingConversationService(
        prisma as any,
        { classifierChat: { withStructuredOutput: () => ({ invoke }) } } as any,
        financing,
        { create } as any,
        commercial,
        stock,
      );
      const turn = async (content: string) => {
        const m = await prisma.message.create({
          data: { conversationId: c.id, role: 'USER', content },
        });
        const result = await handler.handle(c.id, m.id, content, {
          userType: 'CLIENTE',
        } as any);
        if (result.response)
          await prisma.message.create({
            data: {
              conversationId: c.id,
              role: 'ASSISTANT',
              content: result.response,
            },
          });
        return result;
      };
      const start = await turn('es para financiación.');
      expect(start.handled).toBe(true);
      const details = await turn(
        'mi nombre es: Mauro Armas\nDNI: 90000001\nModelo: Heladera Exhibidora Vertical Briket 390 Litros Led',
      );
      expect(details.response).toMatch(/personal.*comercio.*localidad/);
      expect(details.response).not.toMatch(/creamos|aprobación/);
      const draft = await financing.getDraft(c.id);
      expect(draft).toMatchObject({
        name: 'Mauro Armas',
        dni: '90000001',
        sku: 'EXH-BRI-390',
      });
      expect(
        await prisma.purchaseRequest.count({ where: { conversationId: c.id } }),
      ).toBe(0);
      const result = await turn(
        personal
          ? 'Es para mi casa. Localidad: Posadas'
          : 'Comercio: Almacén Mauro\nLocalidad: Posadas',
      );
      expect(result.response).toContain('creamos el pedido de financiación');
      const request = await prisma.purchaseRequest.findFirstOrThrow({
        where: { conversationId: c.id },
      });
      expect(request.status).toBe('PENDING_REVIEW');
      expect(request.inputSnapshot).toMatchObject({
        purchaseUse: personal ? 'PERSONAL' : 'BUSINESS',
        locality: 'Posadas',
      });
      const prospect = await prisma.prospect.findUniqueOrThrow({
        where: { id: request.prospectId! },
      });
      expect(prospect.name).toBe('Mauro Armas');
      expect(prospect.comercio).toBe(personal ? null : 'Almacén Mauro');
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('inicia financiación al decir «me interesa financiarla» y no deriva la respuesta con nombre y DNI', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        externalId: '549' + String(Date.now()).slice(-10) + '77',
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
    const customer = { userType: 'CLIENTE' } as any;
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content:
          'Elegiste la Heladera Exhibidora Vertical Inelro 420 Litros Forzador. ¿Te interesa financiarla?',
      },
    });
    invoke.mockResolvedValueOnce({ intent: 'INFORMATION' });
    const started = await handler.handle(
      conversation.id,
      randomUUID(),
      'me interesa financiarla',
      customer,
    );
    expect(started.handled).toBe(true);
    expect(started.response).toMatch(/nombre.*DNI/i);

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content:
          'Para avanzar con la financiación necesito tu nombre y tu DNI.',
      },
    });
    invoke.mockResolvedValueOnce({ intent: 'OTHER' });
    const details = await handler.handle(
      conversation.id,
      randomUUID(),
      'Mauro Armas - 90000001',
      customer,
    );
    expect(details.handled).toBe(true);
    expect(details.response).toMatch(/comercio.*localidad/i);
    expect(escalate).not.toHaveBeenCalled();
    const draft = await financing.getDraft(conversation.id);
    expect(draft.name).toBe('Mauro Armas');
    expect(draft.dni).toBe('90000001');
    expect(draft.productSummary).toContain('Inelro 420');
    expect(draft.confirmedAmount).toBe('840000.00');
    expect(draft.missingFields).toEqual(['business', 'locality']);
    expect(
      await prisma.purchaseRequest.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(0);
  });
  it.each([false, true])(
    'conserva producto e identidad en WhatsApp (prospecto previo: %s)',
    async (withProspect) => {
      const c = await prisma.conversation.create({
        data: {
          externalId: '549' + String(Date.now()).slice(-10) + '88',
          channel: 'WHATSAPP',
        },
      });
      const product = 'Heladera Exhibidora Vertical Inelro 420 Litros Forzador';
      await prisma.message.createMany({
        data: [
          {
            conversationId: c.id,
            role: 'USER',
            content:
              'me gusta la opcion Exhibidora Vertical Inelro 420 Litros Forzador',
          },
          {
            conversationId: c.id,
            role: 'ASSISTANT',
            content:
              'Genial, la Inelro de 420 litros está disponible. ¿Preferís financiación?',
          },
        ],
      });
      const prospect = withProspect
        ? await prisma.prospect.create({
            data: {
              phone: c.externalId,
              name: 'Cliente',
              productInterest: product,
              conversationId: c.id,
              originChannel: 'WHATSAPP',
              notes: 'Interés recogido durante la conversación',
            },
          })
        : null;
      if (withProspect)
        await prisma.message.createMany({
          data: Array.from({ length: 14 }, (_, i) => ({
            conversationId: c.id,
            role: 'USER' as const,
            content: 'Consulta anterior ' + i,
          })),
        });
      const invoke = jest.fn();
      const handler = new FinancingConversationService(
        prisma as any,
        { classifierChat: { withStructuredOutput: () => ({ invoke }) } } as any,
        financing,
        { create: jest.fn() } as any,
        commercial,
        stock,
      );
      const customer = { userType: 'CLIENTE' } as any;
      invoke.mockResolvedValueOnce({ intent: 'REQUEST' });
      await handler.handle(
        c.id,
        randomUUID(),
        'quiero la financiacion',
        customer,
      );
      let draft = await financing.getDraft(c.id);
      expect(draft.sku).toBe('EXH-INH-420');
      expect(draft.confirmedAmount).toBe('840000.00');
      invoke.mockResolvedValueOnce({
        intent: 'PROVIDE_DATA',
        name: { value: 'Mauro Armas', evidence: 'Mauro Armas' },
      });
      await handler.handle(
        c.id,
        randomUUID(),
        'Mauro Armas - 90000005',
        customer,
      );
      // La identidad debe sobrevivir aunque la extracción confunda el producto con un nombre.
      await prisma.message.createMany({
        data: Array.from({ length: 14 }, (_, i) => ({
          conversationId: c.id,
          role: 'USER' as const,
          content: 'Consulta intermedia ' + i,
        })),
      });
      invoke.mockResolvedValueOnce({
        intent: 'PROVIDE_DATA',
        name: { value: product, evidence: product },
        productSummary: { value: product, evidence: product },
      });
      await handler.handle(c.id, randomUUID(), product, customer);
      draft = await financing.getDraft(c.id);
      expect(draft.name).toBe('Mauro Armas');
      expect(draft.sku).toBe('EXH-INH-420');
      invoke.mockResolvedValueOnce({
        intent: 'PROVIDE_DATA',
        locality: { value: 'Concepción', evidence: 'Concepción' },
      });
      await handler.handle(
        c.id,
        randomUUID(),
        'Mi dni es: 90000005 - Comercio Maurito - Concepción ,Tucumán',
        customer,
      );
      const order = await prisma.purchaseRequest.findFirstOrThrow({
        where: { conversationId: c.id },
      });
      if (prospect) expect(order.prospectId).toBe(prospect.id);
      expect((order.inputSnapshot as any).name).toBe('Mauro Armas');
      expect((order.inputSnapshot as any).dni).toBe('90000005');
      expect((order.inputSnapshot as any).business).toBe('Comercio Maurito');
      expect(
        await prisma.prospect.count({ where: { conversationId: c.id } }),
      ).toBe(1);
    },
  );
  it('registra el prospecto incompleto y completa el mensaje etiquetado incluso si falla Gemini', async () => {
    const c = await prisma.conversation.create({
      data: {
        externalId: '549' + String(Date.now()).slice(-10) + '89',
        channel: 'WHATSAPP',
      },
    });
    await financing.applyInput(c.id, randomUUID(), {
      intent: 'REQUEST',
      flowVersion: 2,
      sku: 'EXH-BRI-390',
      productSummary: 'Heladera Exhibidora Vertical Briket 390 Litros Led',
    });
    const lead = await prisma.prospect.findFirstOrThrow({
      where: { conversationId: c.id },
    });
    expect(lead.syncStatus).toBe('PENDING');
    expect(
      await prisma.purchaseRequest.count({ where: { conversationId: c.id } }),
    ).toBe(0);
    const handler = new FinancingConversationService(
      prisma as any,
      {
        classifierChat: {
          withStructuredOutput: () => ({
            invoke: jest
              .fn()
              .mockRejectedValue(new Error('classifier unavailable')),
          }),
        },
      } as any,
      financing,
      { create: jest.fn() } as any,
      commercial,
      stock,
    );
    const result = await handler.handle(
      c.id,
      randomUUID(),
      'Nombre: Mauro Armas\nDNI: 90000001\nComercio: Mauricio Electrodomesticos\nLocalidad: Concepción, Tucumán',
      { userType: 'CLIENTE' } as any,
    );
    expect(result.response).toContain('creamos el pedido');
    const request = await prisma.purchaseRequest.findFirstOrThrow({
      where: { conversationId: c.id },
    });
    expect(request.prospectId).toBe(lead.id);
    const updated = await prisma.prospect.findUniqueOrThrow({
      where: { id: lead.id },
    });
    expect(updated).toMatchObject({
      name: 'Mauro Armas',
      comercio: 'Mauricio Electrodomesticos',
      localidad: 'Concepción, Tucumán',
      syncStatus: 'PENDING',
    });
    const { toCrmSheet, localCrmRecord } =
      await import('../ai/integrations/crm-sheet.mapper');
    expect(toCrmSheet(localCrmRecord(updated))).toMatchObject({
      Nombre: 'Mauro Armas',
      Comercio: 'Mauricio Electrodomesticos',
      Localidad: 'Concepción, Tucumán',
    });
    expect(
      await prisma.prospect.count({ where: { conversationId: c.id } }),
    ).toBe(1);
  });
  it('cancela el prospecto de una financiación aún incompleta', async () => {
    const c = await prisma.conversation.create({
      data: {
        externalId: '549' + String(Date.now()).slice(-10) + '90',
        channel: 'WEB',
      },
    });
    await financing.applyInput(c.id, randomUUID(), {
      intent: 'REQUEST',
      flowVersion: 2,
      sku: 'EXH-BRI-390',
      productSummary: 'Heladera Exhibidora Vertical Briket 390 Litros Led',
    });
    await financing.applyInput(c.id, randomUUID(), { intent: 'CANCEL' });
    expect(
      await prisma.prospect.findFirstOrThrow({
        where: { conversationId: c.id },
      }),
    ).toMatchObject({ status: 'CANCELADO', syncStatus: 'PENDING' });
  });
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
  it.each([2, 1, 0])(
    'interpreta «la que está disponible» con %s alternativas sin inventar un producto ni escalar',
    async (availableCount) => {
      const conversation = await prisma.conversation.create({
        data: {
          externalId:
            '549' + String(Date.now()).slice(-10) + String(availableCount),
          channel: 'WEB',
        },
      });
      await financing.applyInput(conversation.id, randomUUID(), {
        intent: 'REQUEST',
        flowVersion: 2,
        dni: '30000008',
        productSummary: 'cortadora de fiambre',
      });
      const options = (await stock.listCatalog())
        .filter((item) => item.name.includes('Cortadora') && item.stock > 0)
        .slice(0, availableCount);
      expect(options).toHaveLength(availableCount);
      const escalate = jest.fn();
      const handler = new FinancingConversationService(
        prisma as any,
        {
          classifierChat: {
            withStructuredOutput: () => ({
              invoke: jest.fn().mockResolvedValue({
                intent: 'PROVIDE_DATA',
                productSummary: {
                  value: 'la que está disponible',
                  evidence: 'la que está disponible',
                },
              }),
            }),
          },
        } as any,
        financing,
        { create: escalate } as any,
        commercial,
        { listCatalog: async () => options } as any,
      );
      const result = await handler.handle(
        conversation.id,
        randomUUID(),
        'la que está disponible',
        { userType: 'CLIENTE' } as any,
      );
      expect(result.handled).toBe(true);
      expect(escalate).not.toHaveBeenCalled();
      const saved = await financing.getDraft(conversation.id);
      expect(saved.dni).toBe('30000008');
      expect(saved.productSummary).not.toBe('la que está disponible');
      if (availableCount === 1) {
        expect(saved.sku).toBe(options[0].sku);
        expect(saved.productSummary).toBe(options[0].name);
      } else {
        expect(saved.productSummary).toBe('cortadora de fiambre');
        expect(saved.sku).toBeUndefined();
        expect(result.response).toMatch(
          availableCount > 1 ? /más de un modelo/ : /Qué modelo/,
        );
      }
      expect(
        (
          await prisma.conversation.findUniqueOrThrow({
            where: { id: conversation.id },
          })
        ).status,
      ).toBe('ACTIVE');
    },
  );
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
