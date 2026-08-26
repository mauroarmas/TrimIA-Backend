import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocumentReviewService } from '../../improvements/document-review.service';

interface DocumentReviewJob {
  reviewId: string;
}

/**
 * El detector de documentos inconclusos, fuera del request (spec 011,
 * Principio IV). La primera corrida de un área grande son ~137 segundos: no
 * hay forma de que viva en un request, y no hace falta que lo haga porque
 * quien la pidió no espera (FR-013).
 *
 * `concurrency: 1` a propósito: el análisis ya es secuencial por decisión
 * medida (D3 — en paralelo tardó MÁS por documento), así que correr dos
 * revisiones a la vez solo empeoraría el límite de tasa.
 *
 * `runReview()` deja la revisión en `READY` o `FAILED` con motivo antes de que
 * este processor termine — nunca a medias (FR-017).
 */
@Processor('document-review', { concurrency: 1 })
export class DocumentReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentReviewProcessor.name);

  constructor(private readonly reviews: DocumentReviewService) {
    super();
  }

  async process(job: Job<DocumentReviewJob>): Promise<void> {
    const { reviewId } = job.data;
    try {
      await this.reviews.runReview(reviewId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Revisión ${reviewId} falló: ${message}`);
      // runReview() ya dejó la revisión en FAILED con el motivo.
    }
  }
}
