import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InterviewsService } from '../../interviews/interviews.service';
import { MaterialDePregunta } from '../../interviews/interviews-questions';

interface InterviewOpenJob {
  sessionId: string;
  material: MaterialDePregunta[];
}

/**
 * Redacta las preguntas de una sesión fuera del request HTTP (spec 010, D4,
 * Principio IV). `concurrency: 1` no hace falta acá como barrera de
 * duplicados —cada sesión es su propio job, sin equivalente al 409 de
 * `coverage-scan`— pero se mantiene por consistencia y para no disparar N
 * llamadas de chat en paralelo sin necesidad.
 *
 * `InterviewsService.runOpen()` deja la sesión en `FALLIDA` con motivo antes
 * de que este processor termine — nunca en `EN_CURSO` a medias.
 */
@Processor('interview-open', { concurrency: 1 })
export class InterviewOpenProcessor extends WorkerHost {
  private readonly logger = new Logger(InterviewOpenProcessor.name);

  constructor(private readonly interviews: InterviewsService) {
    super();
  }

  async process(job: Job<InterviewOpenJob>): Promise<void> {
    const { sessionId, material } = job.data;
    try {
      await this.interviews.runOpen(sessionId, material);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Apertura ${sessionId} falló: ${message}`);
      // runOpen() ya dejó la sesión en FALLIDA con el motivo.
    }
  }
}
