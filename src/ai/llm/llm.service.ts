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

  /** Nombre del modelo en uso. Se persiste en TokenUsage para análisis de costos. */
  readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model = this.config.get<string>('GEMINI_MODEL')!;
    this.chat = new ChatGoogleGenerativeAI({
      apiKey: this.config.get<string>('GOOGLE_API_KEY'),
      model: this.model,
      temperature: 0.7,
    });
    this.logger.log(`Gemini LLM inicializado con modelo: ${this.model}`);
  }
}
