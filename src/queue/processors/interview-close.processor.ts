import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InterviewsCandidatesService } from '../../interviews/interviews-candidates.service';

interface InterviewCloseJob {
  sessionId: string;
}

/**
 * Redacta una ficha por respuesta útil, fuera del request HTTP (spec 010,
 * D4, Principio IV). `InterviewsCandidatesService.runClose()` deja la
 * sesión en `EN_REVISION` — o `FALLIDA` con motivo si algo catastrófico
 * impidió terminar — nunca a medias.
 */
@Processor('interview-close', { concurrency: 1 })
export class InterviewCloseProcessor extends WorkerHost {
  private readonly logger = new Logger(InterviewCloseProcessor.name);

  constructor(private readonly candidates: InterviewsCandidatesService) {
    super();
  }

  async process(job: Job<InterviewCloseJob>): Promise<void> {
    const { sessionId } = job.data;
    try {
      await this.candidates.runClose(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cierre ${sessionId} falló: ${message}`);
    }
  }
}
