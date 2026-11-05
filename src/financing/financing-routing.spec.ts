import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { FinancingConversationService } from './financing-conversation.service';
const client = {
  userType: 'CLIENTE',
  role: null,
  areas: [],
  esGerente: false,
} as any;
describe('financial operation routing boundary', () => {
  const prisma: any = { conversation: { findUnique: jest.fn() } };
  const invoke = jest.fn();
  const llm: any = {
    classifierChat: { withStructuredOutput: jest.fn(() => ({ invoke })) },
  };
  const applyInput = jest
    .fn()
    .mockResolvedValue({ handled: true, response: 'Datos guardados' });
  const service = new FinancingConversationService(prisma, llm, {
    applyInput,
  } as any);
  beforeEach(() => {
    jest.clearAllMocks();
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
