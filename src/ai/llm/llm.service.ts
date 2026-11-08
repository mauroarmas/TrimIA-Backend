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
] as const;
const SETTING_KEY = 'trimia:ai:chat-model:v1';
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

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {
    this.defaultModel = config.get<string>('GEMINI_MODEL')!;
    this.current = this.clients(this.defaultModel);
  }
  private clients(model: string): Clients {
    const base = { apiKey: this.config.get<string>('GOOGLE_API_KEY'), model };
    // Gemini 3.8 no admite los parámetros de muestreo de las versiones previas.
    return {
      model,
      chat: new ChatGoogleGenerativeAI({
        ...base,
        ...(model === 'gemini-3.8-flash'
          ? { thinkingConfig: { thinkingLevel: 'LOW' as const }, maxRetries: 0 }
          : { temperature: 0.7 }),
      }),
      classifierChat: new ChatGoogleGenerativeAI({
        ...base,
        ...(model === 'gemini-3.8-flash'
          ? { thinkingConfig: { thinkingLevel: 'LOW' as const }, maxRetries: 0 }
          : { temperature: 0 }),
      }),
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
