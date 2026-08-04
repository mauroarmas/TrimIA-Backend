import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { EscalationsModule } from '../../escalations/escalations.module';
import { AgentsService } from './agents.service';

@Module({
  imports: [KnowledgeModule, EscalationsModule], // RAG + creación de casos pendientes (Sprint 3)
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
