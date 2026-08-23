import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeStorageService } from './knowledge-storage.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeUsageService } from './knowledge-usage.service';
import { KnowledgeAiEditService } from './knowledge-ai-edit.service';
import { KnowledgeHygieneService } from './knowledge-hygiene.service';
import { KnowledgeMergeService } from './knowledge-merge.service';
import { KnowledgeHygieneController } from './knowledge-hygiene.controller';
import { TEXT_EXTRACTORS } from './extractors/text-extractor.port';
import { PdfExtractor } from './extractors/pdf.extractor';
import { DocxExtractor } from './extractors/docx.extractor';
import { ImageExtractor } from './extractors/image.extractor';
import { AudioExtractor } from './extractors/audio.extractor';
import { EmployeesModule } from '../../employees/employees.module';

/**
 * Módulo del motor RAG (Fase 4). Expone KnowledgeService para que los
 * agentes recuperen contexto en el nodo retrieve_context (Incremento 2).
 *
 * Sprint 5A: registra las colas `knowledge-reindex` y `knowledge-ingestion`
 * para poder *encolar*. Los workers que las consumen viven en QueueModule,
 * junto al resto de los processors — acá solo se necesita el productor.
 * Spec 008 agrega `hygiene-scan` con el mismo reparto.
 *
 * `TEXT_EXTRACTORS` arma la lista de extractores en un solo lugar. Sumar un
 * formato nuevo es escribir la clase y agregarla a este array: ni el servicio
 * de ingestión ni el processor tienen que enterarse (Principio V).
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'knowledge-reindex' },
      { name: 'knowledge-ingestion' },
      { name: 'hygiene-scan' },
    ),
    // Spec 005: la regla de escritura necesita las áreas del empleado autenticado.
    // EmployeesModule solo depende de Prisma y Auth, así que no hay ciclo.
    EmployeesModule,
  ],
  providers: [
    KnowledgeService,
    KnowledgeStorageService,
    KnowledgeIngestionService,
    KnowledgeUsageService,
    KnowledgeAiEditService,
    KnowledgeHygieneService,
    KnowledgeMergeService,
    PdfExtractor,
    DocxExtractor,
    ImageExtractor,
    AudioExtractor,
    {
      provide: TEXT_EXTRACTORS,
      useFactory: (...extractors: unknown[]) => extractors,
      inject: [PdfExtractor, DocxExtractor, ImageExtractor, AudioExtractor],
    },
  ],
  controllers: [KnowledgeController, KnowledgeHygieneController],
  exports: [
    KnowledgeService,
    KnowledgeStorageService,
    KnowledgeIngestionService,
    KnowledgeUsageService,
    KnowledgeAiEditService,
    KnowledgeHygieneService,
    KnowledgeMergeService,
    TEXT_EXTRACTORS,
  ],
})
export class KnowledgeModule {}
