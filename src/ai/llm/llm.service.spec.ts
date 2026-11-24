import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { LlmService } from './llm.service';

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest
    .fn()
    .mockImplementation((options) => ({ options })),
}));
describe('selección persistida del modelo conversacional', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    (ChatGoogleGenerativeAI as unknown as jest.Mock).mockReset();
    (ChatGoogleGenerativeAI as unknown as jest.Mock).mockImplementation(
      (options) => ({ options }),
    );
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  function fixture() {
    let record: string | null = null;
    const redis: any = {
      get: jest.fn(async () => record),
      eval: jest.fn(
        async (_script, _count, _key, defaultModel, expected, next) => {
          if ((record ? JSON.parse(record).model : defaultModel) !== expected)
            return 0;
          record = next;
          return 1;
        },
      ),
    };
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ supportedGenerationMethods: ['generateContent'] }),
    })) as any;
    const config = new ConfigService({
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      GOOGLE_API_KEY: 'test-key',
    });
    return { redis, config, llm: new LlmService(config, redis) };
  }
  it('actualiza ambos clientes y recupera la elección al reiniciar', async () => {
    const { llm, redis, config } = fixture();
    await llm.selectModel('gemini-3.8-flash', llm.model, 'actor');
    expect(llm.model).toBe('gemini-3.8-flash');
    expect((llm.chat as any).options.model).toBe('gemini-3.8-flash');
    expect((llm.classifierChat as any).options.temperature).toBeUndefined();
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.8-flash' }),
    );
    const restarted = new LlmService(config, redis);
    await restarted.onModuleInit();
    expect((await restarted.getSettings()).model).toBe('gemini-3.8-flash');
  });
  it('permite seleccionar gemini-4-hydrogen sin parámetros de muestreo', async () => {
    const { llm } = fixture();
    const settings = await llm.selectModel(
      'gemini-4-hydrogen',
      llm.model,
      'actor',
    );
    expect(settings.model).toBe('gemini-4-hydrogen');
    expect(settings.options).toContainEqual({
      id: 'gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen',
    });
    expect((llm.chat as any).options).toEqual(
      expect.objectContaining({
        model: 'gemini-4-hydrogen',
        thinkingConfig: { thinkingLevel: 'LOW' },
        maxRetries: 0,
      }),
    );
    expect((llm.chat as any).options.temperature).toBeUndefined();
    expect((llm.classifierChat as any).options.temperature).toBeUndefined();
  });
  it('un turno en curso conserva su modelo y atribución aunque cambie el activo', async () => {
    const { llm } = fixture();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const turn = llm.withModelSnapshot(async () => {
      started();
      await gate;
      return llm.model;
    });
    await ready;
    await llm.selectModel('gemini-3.8-flash', llm.activeModel, 'actor');
    release();
    expect(await turn).toBe('gemini-3.5-flash-lite');
    expect(llm.model).toBe('gemini-3.8-flash');
  });
  it('rechaza modelos ajenos y versiones desactualizadas sin escribir', async () => {
    const { llm, redis } = fixture();
    await expect(
      llm.selectModel('gemini-inventado', llm.model, 'actor'),
    ).rejects.toThrow('Modelo no habilitado');
    await expect(
      llm.selectModel('gemini-3.8-flash', 'modelo-viejo', 'actor'),
    ).rejects.toThrow('El modelo cambió');
    expect(redis.eval).not.toHaveBeenCalled();
  });
  it('conserva el modelo si Google rechaza la disponibilidad', async () => {
    const { llm, redis } = fixture();
    global.fetch = jest.fn(async () => ({ ok: false })) as any;
    await expect(
      llm.selectModel('gemini-3.8-flash', llm.model, 'actor'),
    ).rejects.toThrow('Se conserva el anterior');
    expect(llm.model).toBe('gemini-3.5-flash-lite');
    expect(redis.eval).not.toHaveBeenCalled();
  });
  it('detecta un cambio concurrente en Redis sin sobrescribirlo', async () => {
    const { llm, redis } = fixture();
    redis.eval.mockResolvedValueOnce(0);
    await expect(
      llm.selectModel('gemini-3.8-flash', llm.model, 'actor'),
    ).rejects.toThrow('Otro supervisor cambió');
    expect(llm.model).toBe('gemini-3.5-flash-lite');
  });
  it('hace failover inmediato ante un 503 de alta demanda sin bloquear el turno', async () => {
    (ChatGoogleGenerativeAI as unknown as jest.Mock).mockImplementation(
      (options: { model: string }) => ({
        options,
        invoke: jest.fn(async () => {
          if (options.model === 'gemini-3.5-flash-lite') {
            const err: any = new Error(
              '[503 Service Unavailable] This model is currently experiencing high demand.',
            );
            err.status = 503;
            throw err;
          }
          return { content: `ok:${options.model}` };
        }),
        withStructuredOutput: jest.fn(() => ({
          invoke: jest.fn(async () => {
            if (options.model === 'gemini-3.5-flash-lite') {
              const err: any = new Error('503 high demand');
              err.status = 503;
              throw err;
            }
            return { parsed: { intent: 'SALES' }, raw: {} };
          }),
        })),
      }),
    );
    const { llm } = fixture();
    const res = await llm.chat.invoke('hola' as any);
    expect(res).toEqual({ content: 'ok:gemini-2.5-flash' });
    const structured = llm.classifierChat.withStructuredOutput({} as any);
    const parsed = await structured.invoke('hola' as any);
    expect(parsed).toEqual({ parsed: { intent: 'SALES' }, raw: {} });
  });
});
