import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeStorageService } from './knowledge-storage.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeUsageService } from './knowledge-usage.service';
import { TEXT_EXTRACTORS } from './extractors/text-extractor.port';
import { PdfExtractor } from './extractors/pdf.extractor';
import { DocxExtractor } from './extractors/docx.extractor';
import { ImageExtractor } from './extractors/image.extractor';
import { AudioExtractor } from './extractors/audio.extractor';

/**
 * Módulo del motor RAG (Fase 4). Expone KnowledgeService para que los
 * agentes recuperen contexto en el nodo retrieve_context (Incremento 2).
 *
 * Sprint 5A: registra las colas `knowledge-reindex` y `knowledge-ingestion`
 * para poder *encolar*. Los workers que las consumen viven en QueueModule,
 * junto al resto de los processors — acá solo se necesita el productor.
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
    ),
  ],
  providers: [
    KnowledgeService,
    KnowledgeStorageService,
    KnowledgeIngestionService,
    KnowledgeUsageService,
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
  controllers: [KnowledgeController],
  exports: [
    KnowledgeService,
    KnowledgeStorageService,
    KnowledgeIngestionService,
    KnowledgeUsageService,
    TEXT_EXTRACTORS,
  ],
})
export class KnowledgeModule {}
