import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { FinancingConversationService } from './financing-conversation.service';
const client = {
  userType: 'CLIENTE',
  role: null,
  areas: [],
  esGerente: false,
} as any;
describe('financial operation routing boundary', () => {
  const prisma: any = {
    conversation: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  const invoke = jest.fn();
  const llm: any = {
    classifierChat: { withStructuredOutput: jest.fn(() => ({ invoke })) },
  };
  const applyInput = jest
    .fn()
    .mockResolvedValue({ handled: true, response: 'Datos guardados' });
  const getDraft = jest.fn();
  const escalations = { create: jest.fn() };
  const service = new FinancingConversationService(
    prisma,
    llm,
    {
      applyInput,
      getDraft,
    } as any,
    escalations as any,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    getDraft.mockResolvedValue({
      stage: 'COLLECTING',
      missingFields: ['name', 'dni', 'confirmedAmount'],
    });
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WHATSAPP',
      status: 'ACTIVE',
      financingDraft: null,
    });
  });
  it('no transforma consultas informativas en solicitudes', async () => {
    expect(
      await service.handle(
        'c',
        'm',
        '¿Qué requisitos tiene la financiación?',
        client,
      ),
    ).toEqual({ handled: false });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('empleados no entran al formulario de clientes', async () => {
    expect(
      await service.handle('c', 'm', 'Quiero financiación', {
        ...client,
        userType: 'EMPLEADO',
      }),
    ).toEqual({ handled: false });
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['WAITING_HUMAN', 'HUMAN_HANDLING', 'CLOSED'])(
    'respeta pausa %s',
    async (status) => {
      prisma.conversation.findUnique.mockResolvedValue({
        channel: 'WHATSAPP',
        status,
      });
      expect(
        await service.handle('c', 'm', 'Quiero financiación', client),
      ).toEqual({ handled: false });
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it('el simulador WEB de clientes inicia la misma solicitud', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
    });
    invoke.mockResolvedValue({ intent: 'REQUEST' });
    expect(
      await service.handle('c', 'm', 'Quiero financiación', client),
    ).toEqual({ handled: true, response: 'Datos guardados' });
    expect(applyInput).toHaveBeenCalledWith('c', 'm', { intent: 'REQUEST' });
  });
  it('envía a Gemini campos completos sin referencias JSON no admitidas', async () => {
    invoke.mockResolvedValue({ intent: 'REQUEST' });
    await service.handle('c', 'm', 'Quiero financiación', client);
    const schema = llm.classifierChat.withStructuredOutput.mock.calls[0][0];
    const json = toJsonSchema(schema);
    expect(JSON.stringify(json)).not.toContain('"$ref"');
    for (const field of [
      'name',
      'dni',
      'productSummary',
      'sku',
      'observedAmount',
    ]) {
      expect(json).toHaveProperty(`properties.${field}.properties.value`);
      expect(json).toHaveProperty(`properties.${field}.properties.evidence`);
    }
  });
  it('preguntas ajenas vuelven al orquestador sin cambiar RAG', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WHATSAPP',
      status: 'ACTIVE',
      financingDraft: { stage: 'COLLECTING' },
    });
    invoke.mockResolvedValue({ intent: 'OTHER' });
    expect(
      await service.handle('c', 'm', '¿Cuándo llega el reparto?', client),
    ).toEqual({ handled: false });
    expect(applyInput).not.toHaveBeenCalled();
  });
  it('descarta identidad inventada y normaliza DNI solo con evidencia', async () => {
    invoke.mockResolvedValue({
      intent: 'REQUEST',
      name: { value: 'Otra Persona', evidence: 'Cliente' },
      dni: { value: '30000008', evidence: '30.000.008' },
    });
    await service.handle(
      'c',
      'm',
      'Quiero financiación. Cliente, DNI 30.000.008',
      client,
    );
    expect(applyInput).toHaveBeenCalledWith('c', 'm', {
      intent: 'REQUEST',
      dni: '30000008',
    });
  });
  it.each(['', '   '])(
    'omite campos vacíos del modelo al recibir nombre y DNI (%p)',
    async (blank) => {
      prisma.conversation.findUnique.mockResolvedValue({
        channel: 'WEB',
        status: 'ACTIVE',
        financingDraft: { stage: 'COLLECTING' },
      });
      invoke.mockResolvedValue({
        intent: 'PROVIDE_DATA',
        name: { value: 'Abel Lopez', evidence: 'Abel Lopez' },
        dni: { value: '30000008', evidence: '30000008' },
        sku: { value: blank, evidence: blank },
        productSummary: { value: blank, evidence: blank },
        observedAmount: { value: blank, evidence: blank },
      });
      await service.handle(
        'c',
        'm',
        'me llamo Abel Lopez, mi dni es 30000008',
        client,
      );
      expect(applyInput).toHaveBeenCalledWith('c', 'm', {
        intent: 'PROVIDE_DATA',
        name: 'Abel Lopez',
        dni: '30000008',
      });
    },
  );
  it('conserva un DNI etiquetado aunque el modelo lo omita', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: { stage: 'COLLECTING' },
    });
    invoke.mockResolvedValue({
      intent: 'PROVIDE_DATA',
      name: { value: 'Abel Lopez', evidence: 'Abel Lopez' },
    });
    await service.handle(
      'c',
      'm',
      'me llamo Abel Lopez, mi dni es 30000008',
      client,
    );
    expect(applyInput).toHaveBeenCalledWith('c', 'm', {
      intent: 'PROVIDE_DATA',
      name: 'Abel Lopez',
      dni: '30000008',
    });
  });
  it.each([
    'quisiera financiar un smart tv',
    'me gustaría comprar un televisor en cuotas',
    'Quiero que me financien una máquina para cortar fiambres',
    'Mediante financiación',
  ])('inicia formulario con una petición cortés o directa: %s', async (message) => {
    invoke.mockResolvedValue({
      intent: 'REQUEST',
      productSummary: { value: 'televisor', evidence: message },
    });
    await service.handle('c', 'm', message, client);
    expect(applyInput).toHaveBeenCalledWith(
      'c',
      'm',
      expect.objectContaining({ intent: 'REQUEST' }),
    );
  });
  it('acepta valores con tildes devueltos por Gemini aunque la evidencia del usuario no tenga tildes', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: { stage: 'COLLECTING' },
    });
    invoke.mockResolvedValue({
      intent: 'PROVIDE_DATA',
      name: { value: 'Martín Gómez', evidence: 'Martin Gomez' },
      locality: { value: 'Concepción, Tucumán', evidence: 'Concepcion, Tucuman' },
      business: { value: 'Almacén Don José', evidence: 'Almacen Don Jose' },
    });
    await service.handle(
      'c',
      'm',
      'Martin Gomez, Almacen Don Jose, Concepcion, Tucuman',
      client,
    );
    expect(applyInput).toHaveBeenCalledWith(
      'c',
      'm',
      expect.objectContaining({
        intent: 'PROVIDE_DATA',
        name: 'Martín Gómez',
        locality: 'Concepción, Tucumán',
        business: 'Almacén Don José',
      }),
    );
  });
  it('recupera datos dados por el cliente en turnos anteriores de la misma conversación', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: { stage: 'COLLECTING' },
    });
    invoke.mockResolvedValue({
      intent: 'PROVIDE_DATA',
      locality: { value: 'Oberá', evidence: 'Obera' },
    });
    prisma.message = {
      findMany: jest.fn().mockResolvedValue([
        { role: 'USER', content: 'Me llamo Laura Silva, DNI 90000001' },
        { role: 'ASSISTANT', content: '¿De qué localidad sos y tenés comercio?' },
        { role: 'USER', content: 'Local: Despensa El Sol' },
      ]),
    };
    await service.handle('c', 'm', 'Vivo en Obera', client);
    delete prisma.message;
    expect(applyInput).toHaveBeenCalledWith(
      'c',
      'm',
      expect.objectContaining({
        name: 'Laura Silva',
        dni: '90000001',
        business: 'Despensa El Sol',
        locality: 'Oberá',
      }),
    );
  });
  it('resuelve opción numerada del catálogo combinada con datos personales en el mismo mensaje', async () => {
    const stockMock = {
      listCatalog: jest.fn().mockResolvedValue([
        {
          sku: 'COR-MAR-330',
          name: 'Cortadora de Fiambre Marani 330mm Hoja Acero Inox',
          stock: 0,
          listPrice: 650000,
          cashPrice: 540000,
        },
        {
          sku: 'COR-TRI-300',
          name: 'Cortadora de Fiambre Trinidad 300mm Transmisión Sin Fin',
          stock: 3,
          listPrice: 580000,
          cashPrice: 485000,
        },
      ]),
    };
    const modernService = new FinancingConversationService(
      prisma,
      llm,
      { applyInput, getDraft } as any,
      escalations as any,
      {} as any,
      stockMock as any,
    );
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: { stage: 'COLLECTING', flowVersion: 2 },
    });
    prisma.message = {
      findMany: jest.fn().mockResolvedValue([
        {
          role: 'ASSISTANT',
          content:
            'Estas son las opciones:\n1. Cortadora de Fiambre Marani 330mm Hoja Acero Inox — sin stock\n2. Cortadora de Fiambre Trinidad 300mm Transmisión Sin Fin — disponible',
        },
      ]),
    };
    invoke.mockResolvedValue({
      intent: 'PROVIDE_DATA',
    });
    await modernService.handle(
      'c',
      'm',
      'Quiero la 2. Me llamo Sofia Pereyra, DNI 90000006, Local: Fiambreria Norte, vivo en Concepcion, Tucuman',
      client,
    );
    delete prisma.message;
    expect(applyInput).toHaveBeenCalledWith(
      'c',
      'm',
      expect.objectContaining({
        sku: 'COR-TRI-300',
        productSummary:
          'Cortadora de Fiambre Trinidad 300mm Transmisión Sin Fin',
        name: 'Sofia Pereyra',
        dni: '90000006',
        business: 'Fiambreria Norte',
        locality: 'Concepcion, Tucuman',
      }),
    );
  });
  it('una pregunta cortés sobre requisitos sigue siendo informativa', async () => {
    invoke.mockResolvedValue({ intent: 'INFORMATION' });
    expect(
      await service.handle(
        'c',
        'm',
        'Quisiera saber los requisitos para financiar',
        client,
      ),
    ).toEqual({ handled: false });
    expect(applyInput).not.toHaveBeenCalled();
  });
  it('deriva a Ventas cuando únicamente falta confirmar el precio', async () => {
    invoke.mockResolvedValue({ intent: 'REQUEST' });
    getDraft.mockResolvedValue({
      stage: 'COLLECTING',
      productSummary: 'Smart TV LG 50',
      missingFields: ['confirmedAmount'],
    });
    const result = await service.handle(
      'c',
      'm',
      'Quiero financiación',
      client,
    );
    expect(escalations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c',
        agentType: 'SALES',
        internalNote: expect.stringContaining('confirmar el importe'),
      }),
    );
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c', status: { in: ['ACTIVE', 'WAITING_HUMAN'] } },
        data: { status: 'WAITING_HUMAN', currentAgent: 'SALES' },
      }),
    );
    expect(result.response).toContain('Tus datos quedaron guardados');
  });
  it('no deriva mientras faltan datos del cliente', async () => {
    invoke.mockResolvedValue({ intent: 'REQUEST' });
    await service.handle('c', 'm', 'Quiero financiación', client);
    expect(escalations.create).not.toHaveBeenCalled();
  });
  it('no deriva si el precio ya está confirmado', async () => {
    invoke.mockResolvedValue({ intent: 'REQUEST' });
    getDraft.mockResolvedValue({
      stage: 'AWAITING_CONFIRMATION',
      missingFields: ['customerConfirmation'],
    });
    await service.handle('c', 'm', 'Quiero financiación', client);
    expect(escalations.create).not.toHaveBeenCalled();
  });
  it.each([
    'ok, como seguimos?',
    '¿Cómo seguimos?',
    'Quiero continuar con la compra',
  ])(
    'mantiene en Ventas la continuación de una financiación aprobada: %s',
    async (message) => {
      prisma.conversation.findUnique.mockResolvedValue({
        channel: 'WEB',
        status: 'ACTIVE',
        financingDraft: { stage: 'SUBMITTED' },
      });
      getDraft.mockResolvedValue({
        request: { status: 'APPROVED', closedAt: null },
      });
      const result = await service.handle('c', 'm', message, client);
      expect(result.response).toContain('Tu financiación está aprobada');
      expect(escalations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'SALES',
          reason: expect.stringContaining('Venta:'),
        }),
      );
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it('informa revisión pendiente sin escalar a Cobranzas', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: { stage: 'SUBMITTED' },
    });
    getDraft.mockResolvedValue({ request: { status: 'PENDING_REVIEW' } });
    const result = await service.handle('c', 'm', 'como seguimos?', client);
    expect(result.response).toContain('espera la revisión');
    expect(escalations.create).not.toHaveBeenCalled();
  });
  it('no vuelve a ofrecer cierre si la venta ya fue cerrada', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: { stage: 'SUBMITTED' },
    });
    getDraft.mockResolvedValue({
      request: { status: 'APPROVED', closedAt: '2026-11-06T03:00:00Z' },
    });
    expect(
      (await service.handle('c', 'm', 'como seguimos?', client)).response,
    ).toContain('ya figura cerrada');
    expect(escalations.create).not.toHaveBeenCalled();
  });
  it('libera la conversación al orquestador para consultas posteriores una vez cerrada la venta del flujo comercial moderno', async () => {
    const commercialStub = { customerMessage: jest.fn() };
    const stockStub = { listCatalog: jest.fn().mockResolvedValue([]) };
    prisma.purchaseRequest = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'req-closed',
        status: 'APPROVED',
        closedAt: new Date('2026-11-21T23:16:00Z'),
        commercialFlow: { version: 2, stage: 'CLOSED', offers: [] },
      }),
    };
    const modernService = new FinancingConversationService(
      prisma,
      llm,
      { applyInput, getDraft } as any,
      escalations as any,
      commercialStub as any,
      stockStub as any,
    );
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: {
        stage: 'SUBMITTED',
        flowVersion: 2,
        purchaseRequestId: 'req-closed',
      },
    });
    for (const msg of [
      'ok! para mandarte la transferencia a que CBU?',
      'quiero hacer el pago',
      '¿en qué horario puedo pasar a retirar por sucursal?',
    ]) {
      expect(await modernService.handle('c', 'm', msg, client)).toEqual({
        handled: false,
      });
    }
    expect(commercialStub.customerMessage).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();

    // Si después de cerrar la venta pide iniciar otra financiación, sí debe abrir un nuevo pedido
    invoke.mockResolvedValueOnce({
      intent: 'OTHER',
      productSummary: { value: 'heladera', evidence: 'heladera' },
    });
    stockStub.listCatalog.mockResolvedValueOnce([
      {
        sku: 'EXH-BRI-390',
        name: 'Heladera Exhibidora Vertical Briket 390 Litros Led',
        stock: 2,
        listPrice: 720000,
        cashPrice: 600000,
      },
    ]);
    await modernService.handle('c', 'm2', 'Quiero financiar una heladera', client);
    expect(applyInput).toHaveBeenCalledWith(
      'c',
      'm2',
      expect.objectContaining({
        intent: 'REQUEST',
        flowVersion: 2,
        sku: 'EXH-BRI-390',
      }),
    );
    delete prisma.purchaseRequest;
  });
  it('acumula múltiples productos cuando el cliente elige uno y pide agregar otro, preguntando si necesita algo más', async () => {
    const stockMock = {
      listCatalog: jest.fn().mockResolvedValue([
        {
          sku: 'COR-BER-300',
          name: 'Cortadora de Fiambre Berkley 300mm Profesional',
          stock: 3,
          listPrice: 610000,
          cashPrice: 510000,
        },
        {
          sku: 'BAL-SYS-CUORA',
          name: 'Balanza Electrónica Systel Cuora 30kg con Impresor',
          stock: 4,
          listPrice: 420000,
          cashPrice: 350000,
        },
        {
          sku: 'BAL-MOR-40',
          name: 'Balanza Comercial Moretti 40kg con Batería',
          stock: 5,
          listPrice: 165000,
          cashPrice: 140000,
        },
      ]),
    };
    const modernService = new FinancingConversationService(
      prisma,
      llm,
      { applyInput, getDraft } as any,
      escalations as any,
      {} as any,
      stockMock as any,
    );
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: { stage: 'COLLECTING', flowVersion: 2 },
    });
    prisma.message = {
      findMany: jest.fn().mockResolvedValue([
        {
          role: 'ASSISTANT',
          content:
            'Estas son las opciones del catálogo de prueba:\n3. Cortadora de Fiambre Berkley 300mm Profesional — disponible. Lista: $610.000; contado: $510.000\n¿Cuál modelo te interesa?',
        },
      ]),
    };
    invoke.mockResolvedValueOnce({
      intent: 'PROVIDE_DATA',
      productSummary: { value: 'balanza', evidence: 'balanza' },
    });
    const step1 = await modernService.handle(
      'c',
      'm1',
      'me interesa la 3 y también quiero una balanza',
      client,
    );
    expect(step1.response).toContain('Balanza Comercial Moretti 40kg con Batería');
    expect(applyInput).toHaveBeenCalledWith(
      'c',
      'm1',
      expect.objectContaining({
        items: [
          {
            sku: 'COR-BER-300',
            productSummary: 'Cortadora de Fiambre Berkley 300mm Profesional',
            listPrice: '610000.00',
            cashPrice: '510000.00',
          },
        ],
      }),
    );

    // Ahora el cliente elige la balanza de la segunda lista ("2" en nuestra lista reducida)
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
      financingDraft: {
        stage: 'COLLECTING',
        flowVersion: 2,
        sku: 'COR-BER-300',
        productSummary: 'Cortadora de Fiambre Berkley 300mm Profesional',
        items: [
          {
            sku: 'COR-BER-300',
            productSummary: 'Cortadora de Fiambre Berkley 300mm Profesional',
            listPrice: '610000.00',
            cashPrice: '510000.00',
          },
        ],
      },
    });
    prisma.message.findMany.mockResolvedValue([
      {
        role: 'ASSISTANT',
        content:
          'Estas son las opciones del catálogo de prueba:\n1. Balanza Electrónica Systel Cuora 30kg con Impresor — disponible\n2. Balanza Comercial Moretti 40kg con Batería — disponible\n¿Cuál modelo te interesa?',
      },
    ]);
    invoke.mockResolvedValueOnce({ intent: 'PROVIDE_DATA' });
    await modernService.handle('c', 'm2', '2', client);
    expect(applyInput).toHaveBeenLastCalledWith(
      'c',
      'm2',
      expect.objectContaining({
        addMoreProductsPrompt: true,
        sku: 'COR-BER-300 + BAL-MOR-40',
        productSummary:
          'Cortadora de Fiambre Berkley 300mm Profesional + Balanza Comercial Moretti 40kg con Batería',
        items: [
          {
            sku: 'COR-BER-300',
            productSummary: 'Cortadora de Fiambre Berkley 300mm Profesional',
            listPrice: '610000.00',
            cashPrice: '510000.00',
          },
          {
            sku: 'BAL-MOR-40',
            productSummary: 'Balanza Comercial Moretti 40kg con Batería',
            listPrice: '165000.00',
            cashPrice: '140000.00',
          },
        ],
      }),
    );
    delete prisma.message;
  });
  it('no acepta dictamen inyectado por extractor', async () => {
    invoke.mockResolvedValue({
      intent: 'REQUEST',
      score: 900,
      decision: 'APPROVED',
    });
    const r = await service.handle('c', 'm', 'Quiero financiación', client);
    expect(r.handled).toBe(true);
    expect(applyInput).not.toHaveBeenCalled();
  });
  it.each(['Gracias, quedo atento', '__AUDIO_NO_TRANSCRIBIBLE__', 'Hola'])(
    'conserva filtro sin LLM para %s',
    async (message) => {
      prisma.conversation.findUnique.mockResolvedValue({
        channel: 'WHATSAPP',
        status: 'ACTIVE',
        financingDraft: { stage: 'COLLECTING' },
      });
      expect(await service.handle('c', 'm', message, client)).toEqual({
        handled: false,
      });
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});
