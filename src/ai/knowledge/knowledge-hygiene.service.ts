import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  Audience,
  AgentType,
  HygieneScanStatus,
  KnowledgeDocument,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { estaColgado, motivoColgado } from '../../common/stale-job';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeUsageService } from './knowledge-usage.service';

const K = 20;
const MS_ENTRE_LLAMADAS = 700; // 100 RPM del nivel gratuito de Gemini
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mismo prefiltro en toda la feature: área + audiencia (FR-002/FR-003). */
function claveDeGrupo(doc: {
  agentType: AgentType | null;
  audience: Audience;
}) {
  return `${doc.agentType ?? 'GENERAL'}::${doc.audience}`;
}

/** Orden canónico: A siempre el de id menor (data-model.md §2). */
function ordenCanonico(idX: string, idY: string): [string, string] {
  return idX < idY ? [idX, idY] : [idY, idX];
}

export interface PairDocumentView {
  id: string;
  title: string;
  content: string;
  category: string;
  audience: Audience;
  agentType: AgentType | null;
  version: number;
  retrievedCount: number;
  hasData: boolean;
}

export interface HygienePairView {
  pairId: string;
  similarity: number;
  escalatedTurns: number;
  documentA: PairDocumentView;
  documentB: PairDocumentView;
  fusionable: boolean;
  motivoSiNo: string | null;
}

export type ScanEnvelope =
  | { scanId: null; status: 'NEVER_RUN'; pairs: HygienePairView[] }
  | {
      scanId: string;
      status: HygieneScanStatus;
      threshold?: number;
      documentsScanned?: number;
      pairsFound?: number;
      failureReason?: string | null;
      createdAt: Date;
      finishedAt: Date | null;
      pairs: HygienePairView[];
    };

/**
 * Higiene del corpus (spec 008): detecta parejas de documentos que se
 * solapan y las prioriza por cuántos turnos escalados los tuvieron a los dos
 * como candidatos. La fusión en sí (preview/apply) vive en
 * `KnowledgeMergeService` — este servicio solo detecta y descarta.
 */
@Injectable()
export class KnowledgeHygieneService {
  private readonly logger = new Logger(KnowledgeHygieneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly usage: KnowledgeUsageService,
    private readonly config: ConfigService,
    @InjectQueue('hygiene-scan') private readonly queue: Queue,
  ) {}

  // ==========================================================================
  // Lanzar y consultar un barrido (FR-004)
  // ==========================================================================

  /** Encola un barrido nuevo. No corre la detección dentro del request (Principio IV). */
  /**
   * Cierra como `FAILED` un barrido que quedó colgado, para que el próximo
   * pueda arrancar. Devuelve `true` si lo hizo.
   *
   * No se borra en silencio: que se cayó es información, y el resumen de la
   * pantalla ignora los `FAILED` igual.
   */
  private async cerrarSiQuedoColgado(scan: {
    id: string;
    createdAt: Date;
  }): Promise<boolean> {
    const minutos = this.config.get<number>('HYGIENE_SCAN_STALE_MINUTES')!;
    if (!estaColgado(scan.createdAt, minutos)) return false;

    this.logger.warn(
      `El barrido de higiene ${scan.id} quedó colgado más de ${minutos} min: ` +
        `se cierra como FAILED y se arranca uno nuevo`,
    );
    await this.prisma.hygieneScan.update({
      where: { id: scan.id },
      data: {
        status: HygieneScanStatus.FAILED,
        failureReason: motivoColgado(minutos),
        finishedAt: new Date(),
      },
    });
    return true;
  }

  async startScan(employeeId: string) {
    const yaCorriendo = await this.prisma.hygieneScan.findFirst({
      where: { status: HygieneScanStatus.RUNNING },
    });
    // ⚠️ Un barrido que quedó RUNNING porque el worker murió bloquea esta
    // pantalla para siempre: el 409 no vence solo. El encontrado en vivo
    // llevaba 38 horas y dejaba el botón "Analizar" muerto. Ver
    // `src/common/stale-job.ts` — es el mismo criterio de los otros dos
    // barridos, y esta fue su tercera aparición.
    if (yaCorriendo && (await this.cerrarSiQuedoColgado(yaCorriendo))) {
      // Se cerró la muerta: se sigue y se arranca una nueva.
    } else if (yaCorriendo) {
      throw new ConflictException({
        statusCode: 409,
        reason: 'SCAN_ALREADY_RUNNING',
        scanId: yaCorriendo.id,
        message: 'Ya hay un análisis en curso. Esperá a que termine.',
      });
    }

    const documentsToScan = await this.prisma.knowledgeDocument.count({
      where: { isActive: true },
    });

    const scan = await this.prisma.hygieneScan.create({
      data: {
        status: HygieneScanStatus.RUNNING,
        threshold: this.umbralConfigurado() * 100,
        startedById: employeeId,
      },
    });

    await this.queue.add('scan', { scanId: scan.id });

    return {
      scanId: scan.id,
      status: scan.status,
      documentsToScan,
      estimatedSeconds: Math.round(
        documentsToScan * (MS_ENTRE_LLAMADAS / 1000),
      ),
    };
  }

  /**
   * El sobre que abre el panel. `NEVER_RUN` no es un error, y `RUNNING`/`FAILED`
   * vienen acompañados de las parejas de la última corrida `READY` anterior
   * (si existe) para que la pantalla no se quede vacía mientras un barrido
   * nuevo corre ~55 s.
   */
  async latestScan(employeeId: string): Promise<ScanEnvelope> {
    const ultima = await this.prisma.hygieneScan.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!ultima) return { scanId: null, status: 'NEVER_RUN', pairs: [] };

    if (ultima.status === HygieneScanStatus.READY) {
      return {
        scanId: ultima.id,
        status: ultima.status,
        threshold: ultima.threshold,
        documentsScanned: ultima.documentsScanned,
        pairsFound: ultima.pairsFound,
        createdAt: ultima.createdAt,
        finishedAt: ultima.finishedAt,
        pairs: await this.pairsDeCorrida(ultima.id, employeeId),
      };
    }

    // RUNNING o FAILED: mostrar la última corrida READY anterior, si hay.
    const ultimaLista = await this.prisma.hygieneScan.findFirst({
      where: { status: HygieneScanStatus.READY },
      orderBy: { createdAt: 'desc' },
    });

    return {
      scanId: ultima.id,
      status: ultima.status,
      threshold: ultima.threshold,
      documentsScanned: ultima.documentsScanned,
      pairsFound: ultima.pairsFound,
      failureReason: ultima.failureReason,
      createdAt: ultima.createdAt,
      finishedAt: ultima.finishedAt,
      pairs: ultimaLista
        ? await this.pairsDeCorrida(ultimaLista.id, employeeId)
        : [],
    };
  }

  private async pairsDeCorrida(
    scanId: string,
    employeeId: string,
  ): Promise<HygienePairView[]> {
    const pares = await this.prisma.hygienePair.findMany({
      where: { scanId },
      orderBy: [
        { escalatedTurns: 'desc' },
        { similarity: 'desc' },
        { createdAt: 'desc' },
      ],
      include: { documentA: true, documentB: true },
    });

    const idsDocumentos = pares.flatMap((p) => [p.documentAId, p.documentBId]);
    const usoPorDocumento = await this.usage.forDocuments(idsDocumentos);

    const vistas: HygienePairView[] = [];
    for (const par of pares) {
      const [documentA, motivoA] = await this.vistaDocumento(
        par.documentA,
        employeeId,
        usoPorDocumento,
      );
      const [documentB, motivoB] = await this.vistaDocumento(
        par.documentB,
        employeeId,
        usoPorDocumento,
      );

      // FR-017: la pareja se lista igual aunque no se pueda fusionar. Ambos
      // documentos son del mismo área por el prefiltro, así que en la
      // práctica los dos motivos coinciden — pero no depende de esa
      // coincidencia para decidir `fusionable`.
      const fusionable = motivoA === null && motivoB === null;
      const motivoSiNo = motivoA ?? motivoB;

      vistas.push({
        pairId: par.id,
        similarity: par.similarity,
        escalatedTurns: par.escalatedTurns,
        documentA,
        documentB,
        fusionable,
        motivoSiNo,
      });
    }
    return vistas;
  }

  private async vistaDocumento(
    doc: KnowledgeDocument,
    employeeId: string,
    usoPorDocumento: Map<string, { retrievedCount: number; hasData: boolean }>,
  ): Promise<[PairDocumentView, string | null]> {
    let motivo: string | null = null;
    try {
      await this.knowledge.assertPuedeEscribir(employeeId, doc.agentType);
    } catch (err) {
      motivo = err instanceof Error ? err.message : 'No autorizado';
    }

    const uso = usoPorDocumento.get(doc.id);
    return [
      {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        category: doc.category,
        audience: doc.audience,
        agentType: doc.agentType,
        version: doc.version,
        retrievedCount: uso?.retrievedCount ?? 0,
        hasData: uso?.hasData ?? false,
      },
      motivo,
    ];
  }

  // ==========================================================================
  // El barrido en sí (corre en el worker, nunca dentro de un request)
  // ==========================================================================

  /**
   * Llamado por `HygieneScanProcessor`. Deja la corrida en READY o FAILED, y
   * devuelve el `HygieneScan` final (`documentsScanned`/`pairsFound`) para
   * quien lo necesite — el processor solo persiste efectos, no usa el valor.
   */
  async runScan(scanId: string) {
    try {
      const documentos = await this.prisma.knowledgeDocument.findMany({
        where: { isActive: true },
        select: {
          id: true,
          title: true,
          content: true,
          audience: true,
          agentType: true,
          version: true,
        },
      });

      const porGrupo = new Map<string, typeof documentos>();
      for (const doc of documentos) {
        const clave = claveDeGrupo(doc);
        const lista = porGrupo.get(clave) ?? [];
        lista.push(doc);
        porGrupo.set(clave, lista);
      }

      // mejor score visto en cualquier dirección, por pareja canónica.
      const mejorScorePorPareja = new Map<string, number>();

      for (const doc of documentos) {
        const hits = await this.knowledge.search(doc.content, {
          audience: Audience.INTERNO,
          k: K,
        });

        const idsDelGrupo = new Set(
          (porGrupo.get(claveDeGrupo(doc)) ?? []).map((d) => d.id),
        );

        for (const hit of hits) {
          if (hit.documentId === doc.id) continue;
          if (!idsDelGrupo.has(hit.documentId)) continue; // fuera del prefiltro (FR-002/FR-003)

          const [idA, idB] = ordenCanonico(doc.id, hit.documentId);
          const clave = `${idA}::${idB}`;
          const previo = mejorScorePorPareja.get(clave) ?? 0;
          if (hit.score > previo) mejorScorePorPareja.set(clave, hit.score);
        }

        await sleep(MS_ENTRE_LLAMADAS);
      }

      const umbral = this.umbralConfigurado();
      const porId = new Map(documentos.map((d) => [d.id, d]));

      const filasAInsertar: {
        documentAId: string;
        documentBId: string;
        similarity: number;
        versionA: number;
        versionB: number;
      }[] = [];

      for (const [clave, score] of mejorScorePorPareja) {
        if (score < umbral) continue;
        const [idA, idB] = clave.split('::');
        const docA = porId.get(idA);
        const docB = porId.get(idB);
        if (!docA || !docB) continue;

        // FR-013/FR-014: si hay un descarte vigente (mismas versiones), la
        // pareja no vuelve a proponerse.
        const descarte = await this.prisma.knowledgeMergeDiscard.findUnique({
          where: {
            documentAId_documentBId: { documentAId: idA, documentBId: idB },
          },
        });
        if (
          descarte &&
          descarte.versionA === docA.version &&
          descarte.versionB === docB.version
        ) {
          continue;
        }

        filasAInsertar.push({
          documentAId: idA,
          documentBId: idB,
          similarity: score * 100,
          versionA: docA.version,
          versionB: docB.version,
        });
      }

      const scan = await this.prisma.$transaction(async (tx) => {
        const filasConTurnos = await Promise.all(
          filasAInsertar.map(async (fila) => ({
            ...fila,
            scanId,
            escalatedTurns: await this.turnosEscaladosEnComun(
              fila.documentAId,
              fila.documentBId,
            ),
          })),
        );

        if (filasConTurnos.length > 0) {
          await tx.hygienePair.createMany({ data: filasConTurnos });
        }

        return tx.hygieneScan.update({
          where: { id: scanId },
          data: {
            status: HygieneScanStatus.READY,
            documentsScanned: documentos.length,
            pairsFound: filasConTurnos.length,
            finishedAt: new Date(),
          },
        });
      });

      this.logger.log(
        `Barrido ${scanId}: ${scan.documentsScanned} documentos, ${scan.pairsFound} parejas`,
      );
      return scan;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Barrido ${scanId} falló: ${message}`);
      // Una corrida a medias NUNCA se muestra como completa: FAILED, no READY
      // con la mitad de las parejas.
      await this.prisma.hygieneScan.update({
        where: { id: scanId },
        data: {
          status: HygieneScanStatus.FAILED,
          failureReason: message,
          finishedAt: new Date(),
        },
      });
      throw err;
    }
  }

  private umbralConfigurado(): number {
    return this.config.get<number>('KNOWLEDGE_MERGE_THRESHOLD')!;
  }

  /**
   * Turnos escalados que tuvieron a LOS DOS documentos como candidatos.
   *
   * El `DISTINCT` no es decorativo: `skipDuplicates` no deduplica el top-k
   * (research.md §6a), así que sin él un documento largo co-ocurriría consigo
   * mismo. El turno se identifica por `(conversationId, createdAt)` —
   * igualdad exacta dentro de un mismo `createMany` (research.md §7) — y NO
   * por `escalationId`, que agrupa varios turnos de una conversación
   * estancada.
   */
  private async turnosEscaladosEnComun(
    documentAId: string,
    documentBId: string,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      WITH turnos AS (
        SELECT DISTINCT "conversationId", "createdAt", "documentId"
        FROM "KnowledgeRetrieval"
        WHERE outcome = 'ESCALATED' AND "conversationId" IS NOT NULL
      )
      SELECT count(*) FROM (
        SELECT a."conversationId", a."createdAt"
        FROM turnos a JOIN turnos b
          ON a."conversationId" = b."conversationId"
         AND a."createdAt" = b."createdAt"
        WHERE a."documentId" = ${documentAId} AND b."documentId" = ${documentBId}
      ) t
    `;
    return Number(rows[0]?.count ?? 0);
  }

  // ==========================================================================
  // Descarte (US2)
  // ==========================================================================

  /** "Son distintos a propósito". Guarda las versiones VIGENTES (FR-013/FR-014). */
  async discard(
    pairId: string,
    reason: string | undefined,
    employeeId: string,
  ) {
    const pair = await this.prisma.hygienePair.findUnique({
      where: { id: pairId },
      include: { documentA: true, documentB: true },
    });
    if (!pair) throw new NotFoundException('Pareja no encontrada');

    // Descartar es una decisión sobre el corpus: mismo permiso que fusionar
    // (FR-012b). Los dos documentos son del mismo área por el prefiltro.
    await this.knowledge.assertPuedeEscribir(
      employeeId,
      pair.documentA.agentType,
    );

    await this.prisma.knowledgeMergeDiscard.upsert({
      where: {
        documentAId_documentBId: {
          documentAId: pair.documentAId,
          documentBId: pair.documentBId,
        },
      },
      create: {
        documentAId: pair.documentAId,
        documentBId: pair.documentBId,
        versionA: pair.documentA.version,
        versionB: pair.documentB.version,
        reason,
        discardedById: employeeId,
      },
      update: {
        versionA: pair.documentA.version,
        versionB: pair.documentB.version,
        reason,
        discardedById: employeeId,
      },
    });

    return { discarded: true };
  }
}
