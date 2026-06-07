import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

/**
 * Módulo del motor RAG (Fase 4). Expone KnowledgeService para que los
 * agentes recuperen contexto en el nodo retrieve_context (Incremento 2).
 */
@Module({
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
