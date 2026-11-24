import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { RedisService } from '../../redis/redis.service';

export const CHAT_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
] as const;
const THINKING_LOW_MODELS = new Set(['gemini-3.8-flash', 'gemini-4-hydrogen']);
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-4-hydrogen',
  'gemini-3.5-flash-lite',
] as const;
const SETTING_KEY = 'trimia:ai:chat-model:v1';

function isTransientModelError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return true;
  }
  const msg = String((err as Error)?.message ?? err ?? '');
  return /\b(503|429|502|504)\b|high demand|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|ETIMEDOUT|ECONNRESET|fetch failed|AbortError/i.test(
    msg,
  );
}

type Clients = {
  model: string;
  chat: ChatGoogleGenerativeAI;
  classifierChat: ChatGoogleGenerativeAI;
};
type Selection = { model: string; updatedAt: string; updatedBy: string };

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly scope = new AsyncLocalStorage<Clients>();
  private current: Clients;
  private selection: Selection | null = null;
  private readonly defaultModel: string;
  private readonly fallbackClients = new Map<string, ChatGoogleGenerativeAI>();

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {
    this.defaultModel = config.get<string>('GEMINI_MODEL')!;
    this.current = this.clients(this.defaultModel);
  }

  private rawClient(
    model: string,
    kind: 'chat' | 'classifier',
  ): ChatGoogleGenerativeAI {
    const base = { apiKey: this.config.get<string>('GOOGLE_API_KEY'), model };
    const usesThinkingLow = THINKING_LOW_MODELS.has(model);
    // maxRetries: 0 evita que @langchain/google-genai duerma >60s reintentando un 503;
    // el failover inmediato y BullMQ se encargan de la resiliencia sin bloquear el hilo.
    return new ChatGoogleGenerativeAI({
      ...base,
      ...(usesThinkingLow
        ? { thinkingConfig: { thinkingLevel: 'LOW' as const }, maxRetries: 0 }
        : { temperature: kind === 'chat' ? 0.7 : 0, maxRetries: 0 }),
    });
  }

  private getFallbackClient(
    model: string,
    kind: 'chat' | 'classifier',
  ): ChatGoogleGenerativeAI {
    const key = `${kind}:${model}`;
    let cached = this.fallbackClients.get(key);
    if (!cached) {
      cached = this.rawClient(model, kind);
      this.fallbackClients.set(key, cached);
    }
    return cached;
  }

  private wrapRunnerWithFailover<T extends { invoke?: (...args: any[]) => Promise<any> }>(
    primaryRunner: T,
    primaryModel: string,
    kind: 'chat' | 'classifier',
    buildFallbackRunner: (fallbackClient: ChatGoogleGenerativeAI) => T,
  ): T {
    if (!primaryRunner || typeof primaryRunner.invoke !== 'function') {
      return primaryRunner;
    }
    return new Proxy(primaryRunner, {
      get: (target, prop, receiver) => {
        if (prop !== 'invoke') {
          const val = Reflect.get(target, prop, receiver);
          return typeof val === 'function' ? val.bind(target) : val;
        }
        return async (...args: any[]) => {
          try {
            return await target.invoke!(...args);
          } catch (primaryErr) {
            if (!isTransientModelError(primaryErr)) {
              throw primaryErr;
            }
            const candidates = FALLBACK_MODELS.filter((m) => m !== primaryModel);
            for (const candidate of candidates) {
              try {
                this.logger.warn(
                  `Modelo ${primaryModel} no disponible temporalmente (${(primaryErr as Error)?.message?.slice(0, 120) ?? primaryErr}); reintentando al instante con ${candidate}`,
                );
                const fbRunner = buildFallbackRunner(
                  this.getFallbackClient(candidate, kind),
                );
                if (typeof fbRunner?.invoke === 'function') {
                  return await fbRunner.invoke(...args);
                }
              } catch (fbErr) {
                if (!isTransientModelError(fbErr)) {
                  throw fbErr;
                }
              }
            }
            throw primaryErr;
          }
        };
      },
    });
  }

  private resilientClient(
    primary: ChatGoogleGenerativeAI,
    model: string,
    kind: 'chat' | 'classifier',
  ): ChatGoogleGenerativeAI {
    return new Proxy(primary, {
      get: (target, prop, receiver) => {
        if (prop === 'invoke' && typeof target.invoke === 'function') {
          return async (...args: Parameters<ChatGoogleGenerativeAI['invoke']>) => {
            try {
              return await target.invoke(...args);
            } catch (primaryErr) {
              if (!isTransientModelError(primaryErr)) {
                throw primaryErr;
              }
              const candidates = FALLBACK_MODELS.filter((m) => m !== model);
              for (const candidate of candidates) {
                try {
                  this.logger.warn(
                    `Modelo ${model} saturado (${(primaryErr as Error)?.message?.slice(0, 120) ?? primaryErr}); usando respaldo ${candidate}`,
                  );
                  const fb = this.getFallbackClient(candidate, kind);
                  if (typeof fb.invoke === 'function') {
                    return await fb.invoke(...args);
                  }
                } catch (fbErr) {
                  if (!isTransientModelError(fbErr)) {
                    throw fbErr;
                  }
                }
              }
              throw primaryErr;
            }
          };
        }
        if (
          prop === 'withStructuredOutput' &&
          typeof target.withStructuredOutput === 'function'
        ) {
          return (...soArgs: Parameters<ChatGoogleGenerativeAI['withStructuredOutput']>) => {
            const primaryRunner = target.withStructuredOutput(...soArgs);
            return this.wrapRunnerWithFailover(
              primaryRunner as any,
              model,
              kind,
              (fb) => fb.withStructuredOutput(...soArgs) as any,
            );
          };
        }
        if (prop === 'bindTools' && typeof target.bindTools === 'function') {
          return (...btArgs: Parameters<ChatGoogleGenerativeAI['bindTools']>) => {
            const primaryBound = target.bindTools(...btArgs);
            return this.wrapRunnerWithFailover(
              primaryBound as any,
              model,
              kind,
              (fb) => fb.bindTools(...btArgs) as any,
            );
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  private clients(model: string): Clients {
    // Gemini 3.8 y Gemini 4 no admiten los parámetros de muestreo de versiones previas.
    return {
      model,
      chat: this.resilientClient(this.rawClient(model, 'chat'), model, 'chat'),
      classifierChat: this.resilientClient(
        this.rawClient(model, 'classifier'),
        model,
        'classifier',
      ),
    };
  }
  get chat() {
    return (this.scope.getStore() ?? this.current).chat;
  }
  get classifierChat() {
    return (this.scope.getStore() ?? this.current).classifierChat;
  }
  get model() {
    return (this.scope.getStore() ?? this.current).model;
  }
  get activeModel() {
    return this.current.model;
  }

  async onModuleInit() {
    await this.refreshSelection();
    this.logger.log(`Gemini LLM inicializado con modelo: ${this.activeModel}`);
  }
  private async refreshSelection() {
    if (!this.redis) return;
    const raw = await this.redis.get(SETTING_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Selection;
    if (!CHAT_MODELS.some((m) => m.id === saved.model))
      throw new Error('Modelo guardado no admitido');
    if (saved.model !== this.current.model)
      this.current = this.clients(saved.model);
    this.selection = saved;
  }
  async withModelSnapshot<T>(fn: () => Promise<T>): Promise<T> {
    await this.refreshSelection();
    return this.scope.run(this.current, fn);
  }
  async getSettings() {
    await this.refreshSelection();
    return {
      model: this.activeModel,
      options: CHAT_MODELS,
      updatedAt: this.selection?.updatedAt ?? null,
    };
  }
  async selectModel(model: string, expectedModel: string, actorId: string) {
    if (!CHAT_MODELS.some((m) => m.id === model))
      throw new BadRequestException('Modelo no habilitado.');
    await this.refreshSelection();
    if (expectedModel !== this.activeModel)
      throw new ConflictException('El modelo cambió. Actualizá el panel.');
    if (model === this.activeModel) return this.getSettings();
    if (!this.redis)
      throw new ServiceUnavailableException(
        'No se puede guardar la configuración.',
      );
    let supported = false;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
        {
          headers: {
            'x-goog-api-key': this.config.get<string>('GOOGLE_API_KEY')!,
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.ok)
        supported = (
          await response.json()
        ).supportedGenerationMethods?.includes('generateContent');
    } catch {
      /* Mantener el modelo anterior si Google no permite verificarlo. */
    }
    if (!supported)
      throw new ServiceUnavailableException(
        'Google no confirmó disponibilidad del modelo. Se conserva el anterior.',
      );
    const next = this.clients(model);
    const record: Selection = {
      model,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    };
    const changed = await this.redis.eval(
      `local raw = redis.call('GET', KEYS[1]); local model = ARGV[1]; if raw then model = cjson.decode(raw).model end; if model ~= ARGV[2] then return 0 end; redis.call('SET', KEYS[1], ARGV[3]); return 1`,
      1,
      SETTING_KEY,
      this.defaultModel,
      expectedModel,
      JSON.stringify(record),
    );
    if (changed !== 1)
      throw new ConflictException(
        'Otro supervisor cambió el modelo. Actualizá el panel.',
      );
    this.current = next;
    this.selection = record;
    this.logger.log(`Modelo conversacional cambiado a ${model} por ${actorId}`);
    return this.getSettings();
  }
}
