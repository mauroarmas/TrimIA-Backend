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
  ])('inicia formulario con una petición cortés: %s', async (message) => {
    invoke.mockResolvedValue({
      intent: 'REQUEST',
      productSummary: { value: 'televisor', evidence: 'televisor' },
    });
    await service.handle('c', 'm', message, client);
    expect(applyInput).toHaveBeenCalledWith(
      'c',
      'm',
      expect.objectContaining({ intent: 'REQUEST' }),
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
