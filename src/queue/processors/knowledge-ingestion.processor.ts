import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { AgentType, Audience, FileProcessingStatus } from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { KnowledgeService } from '../../ai/knowledge/knowledge.service';
import { KnowledgeStorageService } from '../../ai/knowledge/knowledge-storage.service';
import {
  ExtractionFailedError,
  TEXT_EXTRACTORS,
  TextExtractor,
} from '../../ai/knowledge/extractors/text-extractor.port';

interface KnowledgeIngestionJob {
  fileId: string;
  storagePath: string;
  title: string;
  category: string;
  audience?: Audience;
  agentType?: AgentType | null;
}

/**
 * Extrae el texto de un archivo subido y lo incorpora al RAG (US1, FR-002).
 *
 * Regla que ordena todo el processor: **un archivo que falla no deja
 * documento**. FR-005 prohíbe crear documentos vacíos, porque un documento sin
 * contenido sigue siendo recuperable y devuelve ruido al agente. Por eso
 * `ingest()` se llama recién con el texto ya validado, y cualquier fallo
 * anterior termina en `FAILED` con motivo en castellano.
 */
@Processor('knowledge-ingestion', { concurrency: 1 })
export class KnowledgeIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeIngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly storage: KnowledgeStorageService,
    @Inject(TEXT_EXTRACTORS) private readonly extractors: TextExtractor[],
  ) {
    super();
  }

  async process(job: Job<KnowledgeIngestionJob>): Promise<void> {
    const { fileId, storagePath } = job.data;

    const file = await this.prisma.knowledgeFile.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      // Se borró el archivo mientras esperaba en la cola. Reintentar no lo va
      // a hacer aparecer.
      this.logger.warn(`KnowledgeFile ${fileId} ya no existe — se descarta`);
      throw new UnrecoverableError(`KnowledgeFile ${fileId} no existe`);
    }
    if (file.status !== FileProcessingStatus.PROCESSING) {
      this.logger.warn(`KnowledgeFile ${fileId} ya está ${file.status}`);
      return;
    }

    const extractor = this.extractors.find((e) => e.supports(file.mimeType));
    if (!extractor) {
      // No debería llegar acá: la validación de tipo corre en el upload. Si
      // pasa, es un extractor que se desregistró, no algo que el reintento
      // arregle.
      await this.fail(fileId, `El formato ${file.mimeType} no está soportado.`);
      throw new UnrecoverableError(`Sin extractor para ${file.mimeType}`);
    }

    try {
      const buffer = await this.storage.read(storagePath);
      // El extractor de audio borra el original acá adentro (FR-004); el resto
      // ignora la ruta.
      const text = await extractor.extract(
        buffer,
        file.mimeType,
        this.storage.resolveAbsolutePath(storagePath),
      );

      const { documentId, chunks } = await this.knowledge.ingest({
        title: job.data.title,
        content: text,
        category: job.data.category,
        audience: job.data.audience,
        agentType: job.data.agentType ?? null,
        sourceType: 'DOCUMENTO',
        sourceId: fileId,
      });

      await this.prisma.knowledgeFile.update({
        where: { id: fileId },
        data: {
          status: FileProcessingStatus.READY,
          documentId,
          processedAt: new Date(),
        },
      });

      this.logger.log(
        `"${file.filename}" procesado con ${extractor.name}: ${chunks} chunks`,
      );
    } catch (err) {
      if (err instanceof ExtractionFailedError) {
        // El archivo es el que es: reintentarlo daría el mismo resultado y solo
        // demoraría el aviso al supervisor.
        await this.fail(fileId, err.message);
        throw new UnrecoverableError(err.message);
      }

      // Cualquier otra cosa (Chroma caído, timeout de red) sí puede andar en el
      // próximo intento. Solo se marca FAILED al agotarlos, para no llenar el
      // panel de falsas alarmas por cortes transitorios.
      const message = err instanceof Error ? err.message : String(err);
      const isLastAttempt =
        (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
      this.logger.error(`Error procesando ${fileId}: ${message}`);
      if (isLastAttempt) {
        await this.fail(
          fileId,
          'No se pudo procesar el archivo por un problema del sistema. Volvé a subirlo en unos minutos.',
        );
      }
      throw err;
    }
  }

  private async fail(fileId: string, reason: string): Promise<void> {
    await this.prisma.knowledgeFile.update({
      where: { id: fileId },
      data: {
        status: FileProcessingStatus.FAILED,
        failureReason: reason,
        processedAt: new Date(),
      },
    });
  }
}
