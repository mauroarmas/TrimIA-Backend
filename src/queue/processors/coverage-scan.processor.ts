import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { KnowledgeCoverageService } from '../../ai/knowledge/knowledge-coverage.service';

interface CoverageScanJob {
  scanId: string;
}

/**
 * Corre la corrida de cobertura (spec 009) fuera del request HTTP: agrupa
 * consultas con una llamada de chat y persiste la corrida (Principio IV).
 *
 * `concurrency: 1` por el mismo motivo que `HygieneScanProcessor`: dos
 * corridas en paralelo gastarían dos llamadas para producir lo mismo, y
 * `startScan` ya lo evita con el 409 — esto es la segunda barrera.
 *
 * `KnowledgeCoverageService.runScan()` deja la corrida en `FAILED` con
 * motivo antes de relanzar el error — nunca en `READY` a medias.
 */
@Processor('coverage-scan', { concurrency: 1 })
export class CoverageScanProcessor extends WorkerHost {
  private readonly logger = new Logger(CoverageScanProcessor.name);

  constructor(private readonly coverage: KnowledgeCoverageService) {
    super();
  }

  async process(job: Job<CoverageScanJob>): Promise<void> {
    const { scanId } = job.data;
    try {
      await this.coverage.runScan(scanId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Corrida ${scanId} falló: ${message}`);
      // runScan() ya dejó la corrida en FAILED con el motivo. No reintentar:
      // un fallo del modelo a mitad de camino no se resuelve solo.
    }
  }
}
