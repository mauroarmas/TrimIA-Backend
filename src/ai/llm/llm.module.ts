import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * Módulo global: expone el cliente de Gemini a todo el sistema.
 * Cualquier servicio puede inyectar LlmService sin re-importar el módulo.
 */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
