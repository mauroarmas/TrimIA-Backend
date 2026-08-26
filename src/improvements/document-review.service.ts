import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentType, DocReviewStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { estaColgado, motivoColgado } from '../common/stale-job';
import { LlmService } from '../ai/llm/llm.service';
import {
  senalamientoSchema,
  DETECTOR_PROMPT,
  armarEntradaDocumento,
  Senalamiento,
} from './document-review-prompt';

/**
 * El detector de documentos inconclusos (spec 011, US2).
 *
 * Es lo único genuinamente nuevo de la feature: encuentra qué mejorar **sin
 * depender de que alguien haya preguntado**. Cuatro de las cinco áreas no
 * tienen tráfico suficiente, así que sin esto la pantalla les queda vacía.
 *
 * Corre como job (Principio IV), **secuencial** y **incremental**.
 */
@Injectable()
export class DocumentReviewService {
  private readonly logger = new Logger(DocumentReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly llm: LlmService,
    @InjectQueue('document-review') private readonly queue: Queue,
  ) {}

  /**
   * FR-013/FR-018: encola y devuelve; no bloquea a quien lo pidió.
   *
   * Si ya hay una revisión corriendo para esta área, **se engancha a ella** en
   * vez de rechazar: `refresh` dispara dos análisis, y fallar el request
   * entero porque uno ya estaba corriendo cancelaría también el otro. Dos
   * áreas distintas revisan en paralelo sin engancharse — lo que no se duplica
   * es el trabajo sobre los mismos documentos.
   */
  async startReview(
    sectorId: string,
    agentType: AgentType,
    empleadoId: string,
  ): Promise<{ reviewId: string; status: DocReviewStatus; reused: boolean }> {
    const enCurso = await this.prisma.documentReview.findFirst({
      where: { sectorId, status: DocReviewStatus.RUNNING },
      orderBy: { createdAt: 'desc' },
    });
    if (enCurso && !(await this.cerrarSiQuedoColgada(enCurso))) {
      return {
        reviewId: enCurso.id,
        status: enCurso.status,
        reused: true,
      };
    }

    const review = await this.prisma.documentReview.create({
      data: {
        sectorId,
        agentType,
        startedById: empleadoId,
        // El corte vigente al correr, guardado con la corrida por el mismo
        // motivo que `HygieneScan.threshold`: si alguien recalibra, las
        // corridas viejas se explican con el número que usaron.
        severityCut: this.config.get<number>('DOC_REVIEW_SEVERITY_CUT')!,
      },
    });

    await this.queue.add('review', { reviewId: review.id });
    return { reviewId: review.id, status: review.status, reused: false };
  }

  /**
   * ⚠️ Una revisión puede quedar `RUNNING` **sin que nadie la esté
   * ejecutando**: si el worker se reinicia a mitad de la corrida, o si el
   * proveedor tarda más que el `lockDuration` de BullMQ, el job se marca
   * `stalled` y muere sin pasar por el `catch` de `runReview` — que es lo
   * único que deja la fila en `FAILED`.
   *
   * Sin esto el área queda **bloqueada para siempre**: `startReview` se
   * engancha (`reused: true`) a una revisión que ya nadie va a terminar, y
   * nunca vuelve a arrancar una. Encontrado en la validación en vivo, después
   * de un hot reload — ningún test con mocks lo veía porque en un test el
   * worker no se muere.
   *
   * Se marca `FAILED` con motivo en vez de borrarla en silencio: que se cayó
   * es información, y el resumen de la pantalla la ignora igual.
   *
   * @returns `true` si estaba colgada y se cerró — o sea, se puede arrancar
   *   una nueva.
   */
  private async cerrarSiQuedoColgada(review: {
    id: string;
    createdAt: Date;
  }): Promise<boolean> {
    const minutos = this.config.get<number>('DOC_REVIEW_STALE_MINUTES')!;
    if (!estaColgado(review.createdAt, minutos)) return false;

    this.logger.warn(
      `Revisión ${review.id} quedó colgada más de ${minutos} min: se cierra ` +
        `como FAILED y se arranca una nueva`,
    );
    await this.prisma.documentReview.update({
      where: { id: review.id },
      data: {
        status: DocReviewStatus.FAILED,
        failureReason: motivoColgado(minutos),
        finishedAt: new Date(),
      },
    });
    return true;
  }

  /**
   * Llamado por `DocumentReviewProcessor` (Principio IV). Termina en `READY` o
   * `FAILED`, **nunca a medias** (FR-017): una lista parcial se lee como si
   * fuera todo lo que hay.
   */
  async runReview(reviewId: string): Promise<void> {
    const review = await this.prisma.documentReview.findUnique({
      where: { id: reviewId },
    });
    if (!review) {
      this.logger.warn(`Revisión ${reviewId} no existe`);
      return;
    }

    try {
      const documentos = await this.documentosDelArea(review.agentType);

      // FR-013a — el incremental. Un documento se analiza solo si nunca se
      // analizó o si su versión cambió. La primera corrida paga el costo
      // entero; las siguientes son casi instantáneas, y en el uso real las
      // siguientes son la mayoría.
      const yaAnalizados = await this.prisma.documentFinding.findMany({
        where: { documentId: { in: documentos.map((d) => d.id) } },
        select: { documentId: true, documentVersion: true },
      });
      const versionAnalizada = new Map<string, Set<number>>();
      for (const f of yaAnalizados) {
        const set = versionAnalizada.get(f.documentId) ?? new Set<number>();
        set.add(f.documentVersion);
        versionAnalizada.set(f.documentId, set);
      }
      const sinCambios = new Set(
        documentos
          .filter((d) => versionAnalizada.get(d.id)?.has(d.version))
          .map((d) => d.id),
      );

      let analizados = 0;
      let senalados = 0;

      // ⚠️ Secuencial, no en paralelo. Medido (D3): lotes de 5 tardaron 5,7 s
      // por documento contra 3,7 s secuencial — probablemente el límite de
      // tasa. Lo que ayuda no es el paralelismo, es no rehacer el trabajo.
      for (const doc of documentos) {
        if (sinCambios.has(doc.id)) continue;

        const senalamiento = await this.analizar(doc);
        analizados++;
        if (!senalamiento) continue;

        // FR-014/SC-004: red de contención. Medido (D4), el modelo da 2,8
        // preguntas por señalamiento y ninguno vino vacío — pero un
        // señalamiento sin preguntas no habilita ninguna acción y no se
        // persiste.
        if (senalamiento.unansweredQuestions.length === 0) continue;

        // ⚠️ **Se persiste TODO señalamiento, no solo los que pasan el
        // corte**, y el corte se aplica al LEER (`senalamientosVigentes`).
        //
        // Es lo que hace que el incremental incremente de verdad: la fila es
        // el registro de "este documento, en esta versión, ya se analizó". Si
        // solo se guardaran los que pasan el corte, los ~66 documentos que
        // quedan por debajo se reanalizarían en cada corrida y FR-013a no
        // haría nada — que es la mitad de SC-008.
        //
        // De regalo, recalibrar el corte deja de exigir reanalizar el corpus:
        // los señalamientos ya están, solo cambia cuáles se muestran.
        await this.prisma.documentFinding.create({
          data: {
            reviewId,
            documentId: doc.id,
            documentVersion: doc.version,
            severity: senalamiento.severity,
            reason: senalamiento.reason,
            unansweredQuestions: senalamiento.unansweredQuestions,
          },
        });
        // El resumen de una línea cuenta lo que la persona va a VER, no lo que
        // se guardó: decir "53 señalados" cuando la lista trae 9 sería mentir.
        if (senalamiento.severity >= review.severityCut) senalados++;
      }

      await this.prisma.documentReview.update({
        where: { id: reviewId },
        data: {
          status: DocReviewStatus.READY,
          documentsAnalyzed: analizados,
          documentsSkipped: documentos.length - analizados,
          findingsFound: senalados,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Revisión ${reviewId} falló: ${message}`);
      await this.prisma.documentReview
        .update({
          where: { id: reviewId },
          data: {
            status: DocReviewStatus.FAILED,
            failureReason: message,
            finishedAt: new Date(),
          },
        })
        .catch(() => {
          // No perder el error original si esto también falla.
        });
    }
  }

  /**
   * Los documentos del área **más los transversales** (`agentType` nulo).
   *
   * Los transversales son 15 de los 75 activos, un quinto del corpus: sin
   * ellos serían el único pedazo que nadie revisa nunca. El incremental hace
   * que solo la primera área los pague; sus señalamientos se muestran solo a
   * quien es responsable de todas, que es quien puede corregirlos.
   */
  private async documentosDelArea(agentType: AgentType) {
    return this.prisma.knowledgeDocument.findMany({
      where: { isActive: true, OR: [{ agentType }, { agentType: null }] },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        version: true,
        agentType: true,
      },
    });
  }

  /** Una llamada al modelo por documento. `null` si falló o no aplica. */
  private async analizar(doc: {
    title: string;
    content: string;
    category: string | null;
  }): Promise<Senalamiento | null> {
    // `classifierChat` (temp 0) y no `chat`: esto es juicio sobre un texto,
    // no redacción. El mismo criterio del resto del proyecto.
    const structured = this.llm.classifierChat.withStructuredOutput(
      senalamientoSchema,
      { name: 'document_finding' },
    );
    try {
      return (await structured.invoke([
        new SystemMessage(DETECTOR_PROMPT),
        new HumanMessage(armarEntradaDocumento(doc)),
      ])) as Senalamiento;
    } catch (err) {
      this.logger.warn(
        `El detector falló sobre «${doc.title}»: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }
  }

  // ==========================================================================
  // Lecturas para la lista
  // ==========================================================================

  async ultimaRevision(sectorId: string) {
    return this.prisma.documentReview.findFirst({
      where: { sectorId, status: DocReviewStatus.READY },
      orderBy: { createdAt: 'desc' },
    });
  }

  async hayRevisionCorriendo(sectorId: string): Promise<boolean> {
    const n = await this.prisma.documentReview.count({
      where: { sectorId, status: DocReviewStatus.RUNNING },
    });
    return n > 0;
  }

  /**
   * ⚠️ Los señalamientos **vigentes por documento**, no los de la última
   * corrida.
   *
   * Con el incremental (FR-013a) una corrida puede saltear 20 documentos y
   * analizar 2: esa `DocumentReview` tiene 2 findings, pero los otros 20
   * siguen siendo verdad — nadie tocó esos documentos. Leer "los findings de
   * la última revisión" vaciaría la pantalla en la segunda corrida.
   *
   * Vigente = el `documentVersion` coincide con la `version` actual del
   * documento. Si no coincide, el documento se editó y se reanalizará; hasta
   * entonces ese señalamiento juzgó otro texto y no se muestra.
   */
  async senalamientosVigentes(sectorId: string, agentType: AgentType) {
    const tope = this.config.get<number>('DOC_REVIEW_MAX_FINDINGS')!;

    const corte = this.config.get<number>('DOC_REVIEW_SEVERITY_CUT')!;

    const findings = await this.prisma.documentFinding.findMany({
      where: {
        review: { sectorId },
        severity: { gte: corte },
        document: {
          isActive: true,
          OR: [{ agentType }, { agentType: null }],
        },
      },
      // El corte se aplica acá y no al persistir: ver `runReview`.
      // Se lee del config vigente, no del `severityCut` de la corrida, para
      // que recalibrar tenga efecto sin reanalizar nada.
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      select: {
        documentId: true,
        documentVersion: true,
        severity: true,
        reason: true,
        unansweredQuestions: true,
        document: {
          select: { title: true, version: true, agentType: true },
        },
      },
    });

    const vistos = new Set<string>();
    const vigentes: typeof findings = [];
    for (const f of findings) {
      if (f.documentVersion !== f.document.version) continue;
      if (vistos.has(f.documentId)) continue;
      vistos.add(f.documentId);
      vigentes.push(f);
      if (vigentes.length >= tope) break;
    }
    return vigentes;
  }
}
