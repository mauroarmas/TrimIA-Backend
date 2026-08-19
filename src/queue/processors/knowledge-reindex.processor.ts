import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { KnowledgeService } from '../../ai/knowledge/knowledge.service';

interface ReindexJob {
  documentId: string;
}

/**
 * Reemplaza los chunks vectorizados de un documento editado (Sprint 5A, FR-024).
 *
 * **Por qué esto es un worker y no parte del request**: Postgres y ChromaDB son
 * dos almacenes sin transacción común. Editar toca los dos y no hay forma
 * atómica de hacerlo. El diseño acepta la ventana de inconsistencia pero la
 * hace *visible* y *reintentable*:
 *
 *   PENDING_REINDEX ──(este worker)──> SYNCED
 *          └──(se agotan los reintentos)──> REINDEX_FAILED
 *
 * Mientras no esté `SYNCED`, el panel muestra el documento como
 * desincronizado y el agente sigue respondiendo con la versión anterior. Eso es
 * deliberado: el estado anterior es *viejo*, no *roto*. Lo inaceptable —y lo
 * que este worker existe para evitar— es que el panel muestre una cosa, el
 * agente responda otra, y nada lo delate.
 *
 * `concurrency: 1` porque reindexar el mismo documento dos veces en paralelo
 * podría intercalar el borrado de una corrida con el alta de la otra y dejar el
 * documento a medio vectorizar.
 */
@Processor('knowledge-reindex', { concurrency: 1 })
export class KnowledgeReindexProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeReindexProcessor.name);

  constructor(private readonly knowledge: KnowledgeService) {
    super();
  }

  async process(job: Job<ReindexJob>): Promise<void> {
    const { documentId } = job.data;

    try {
      const chunks = await this.knowledge.reindex(documentId);
      this.logger.log(`Reindexado ${documentId}: ${chunks} chunks`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Un documento borrado entre que se encoló el job y que corrió no es un
      // fallo transitorio: reintentarlo tres veces no lo va a resucitar.
      if (err instanceof Error && err.name === 'NotFoundException') {
        this.logger.warn(
          `Documento ${documentId} ya no existe — se descarta el job`,
        );
        throw new UnrecoverableError(message);
      }

      const isLastAttempt =
        (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
      if (isLastAttempt) {
        // Se agotaron los reintentos: el documento queda marcado para que el
        // supervisor lo vea en el listado y pueda reintentarlo a mano. NO se
        // deja en PENDING_REINDEX, que se confundiría con "todavía en cola".
        await this.knowledge.markReindexFailed(documentId, message);
        this.logger.error(
          `Reindexación de ${documentId} agotó los reintentos: ${message}`,
        );
      }
      throw err; // BullMQ decide si reintenta.
    }
  }
}
