import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AgentsService } from './agents.service';

@Module({
  imports: [KnowledgeModule], // SALES usa KnowledgeService para el RAG
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
