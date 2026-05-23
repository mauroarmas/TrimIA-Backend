import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { OrchestratorService } from './orchestrator.service';
import { OrchestrationLogger } from './orchestration-logger.service';
import { OrchestratorDebugController } from './orchestrator.debug.controller';

@Module({
  imports: [AgentsModule],
  controllers: [OrchestratorDebugController], // temporal, se quita en 3.6
  providers: [OrchestratorService, OrchestrationLogger],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
