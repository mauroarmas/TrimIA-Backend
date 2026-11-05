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
    classifierChat: { withStructuredOutput: () => ({ invoke }) },
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
  it('no atiende otro canal', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      channel: 'WEB',
      status: 'ACTIVE',
    });
    expect(
      await service.handle('c', 'm', 'Quiero financiación', client),
    ).toEqual({ handled: false });
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
