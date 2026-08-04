import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { OrchestratorService } from './orchestrator.service';
import { OrchestrationLoggerModule } from './orchestration-logger.module';

@Module({
  imports: [AgentsModule, OrchestrationLoggerModule],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
