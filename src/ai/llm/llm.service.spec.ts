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
});
