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

  constructor(private readonly config: ConfigService) {
    const model = this.config.get<string>('GEMINI_MODEL')!;
    this.chat = new ChatGoogleGenerativeAI({
      apiKey: this.config.get<string>('GOOGLE_API_KEY'),
      model,
      temperature: 0.7,
    });
    this.logger.log(`Gemini LLM inicializado con modelo: ${model}`);
  }
}
