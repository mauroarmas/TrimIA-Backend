import { Module } from '@nestjs/common';
import { OrchestrationLogger } from './orchestration-logger.service';

/**
 * Extraído de OrchestratorModule (Sprint 3) para que EscalationsModule y
 * ConversationsModule puedan auditar (OE-11) sin importar OrchestratorModule
 * → AgentsModule, que a su vez importará EscalationsModule (evita ciclo).
 */
@Module({
  providers: [OrchestrationLogger],
  exports: [OrchestrationLogger],
})
export class OrchestrationLoggerModule {}
