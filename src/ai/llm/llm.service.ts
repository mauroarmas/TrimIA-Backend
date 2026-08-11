import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  /**
   * Cliente de Gemini compartido. Se instancia una sola vez al arrancar
   * y se reutiliza en todos los nodos de los grafos.
   */
  readonly chat: ChatGoogleGenerativeAI;

  /**
   * Mismo modelo a temperature 0, para nodos de clasificación
   * (classify_intent, scope_check). Estas decisiones de ruteo deben ser
   * estables: con 0.7 el mismo mensaje podía resolver a un agente distinto
   * entre corridas.
   */
  readonly classifierChat: ChatGoogleGenerativeAI;

  /** Nombre del modelo en uso. Se persiste en TokenUsage para análisis de costos. */
  readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model = this.config.get<string>('GEMINI_MODEL')!;
    const apiKey = this.config.get<string>('GOOGLE_API_KEY');
    this.chat = new ChatGoogleGenerativeAI({
      apiKey,
      model: this.model,
      temperature: 0.7,
    });
    this.classifierChat = new ChatGoogleGenerativeAI({
      apiKey,
      model: this.model,
      temperature: 0,
    });
    this.logger.log(`Gemini LLM inicializado con modelo: ${this.model}`);
  }
}
