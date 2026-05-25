import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { OrchestratorService } from './orchestrator.service';
import { OrchestrationLogger } from './orchestration-logger.service';

@Module({
  imports: [AgentsModule],
  providers: [OrchestratorService, OrchestrationLogger],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
