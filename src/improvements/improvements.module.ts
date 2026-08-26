import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeModule } from '../ai/knowledge/knowledge.module';
import { LlmModule } from '../ai/llm/llm.module';
import { ImprovementsController } from './improvements.controller';
import { ImprovementsService } from './improvements.service';
import { ImprovementsDismissalService } from './improvements-dismissal.service';
import { DocumentReviewService } from './document-review.service';

/**
 * Spec 011 — una sola pantalla para mejorar el conocimiento.
 *
 * ⚠️ **No importa `InterviewsModule`.** La dependencia va en la otra
 * dirección: `InterviewsService` consume este módulo para saber de dónde salen
 * los ítems. Lo que este módulo necesita de la entrevista —qué se preguntó ya—
 * lo lee de `InterviewQuestion` por Prisma, no por servicio. Es lo que evita
 * el ciclo entre los dos módulos.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: 'document-review' }),
    KnowledgeModule,
    LlmModule,
  ],
  controllers: [ImprovementsController],
  providers: [
    ImprovementsService,
    ImprovementsDismissalService,
    DocumentReviewService,
  ],
  exports: [ImprovementsService, DocumentReviewService],
})
export class ImprovementsModule {}
