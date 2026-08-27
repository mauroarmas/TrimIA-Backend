import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { KnowledgeHygieneService } from '../../ai/knowledge/knowledge-hygiene.service';

interface HygieneScanJob {
  scanId: string;
}

/**
 * Corre el barrido de higiene del corpus (spec 008) fuera del request HTTP:
 * son ~78 llamadas de embeddings a 700 ms de intervalo (Principio IV, y el
 * nivel gratuito de Gemini corta a 100 RPM).
 *
 * `concurrency: 1` por el mismo motivo que `KnowledgeReindexProcessor`: dos
 * barridos en paralelo duplicarían el gasto de tokens para producir el mismo
 * resultado (el `startScan` de arriba ya lo evita con el 409, esto es la
 * segunda barrera).
 *
 * `KnowledgeHygieneService.runScan()` deja la corrida en `FAILED` con motivo
 * antes de relanzar el error — nunca en `READY` con la mitad de las parejas.
 */
@Processor('hygiene-scan', { concurrency: 1 })
export class HygieneScanProcessor extends WorkerHost {
  private readonly logger = new Logger(HygieneScanProcessor.name);

  constructor(private readonly hygiene: KnowledgeHygieneService) {
    super();
  }

  async process(job: Job<HygieneScanJob>): Promise<void> {
    const { scanId } = job.data;
    try {
      await this.hygiene.runScan(scanId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Barrido ${scanId} falló: ${message}`);
      // runScan() ya dejó la corrida en FAILED con el motivo. No reintentar:
      // un 429 de Gemini a mitad de camino no se resuelve solo, y reintentar
      // recorrería documentos ya barridos gastando tokens de nuevo.
    }
  }
}
