import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AgentType,
  CoverageBand,
  CoverageCause,
  CoverageScanStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { estaColgado, motivoColgado } from '../../common/stale-job';
import { KnowledgeService } from './knowledge.service';
import {
  KnowledgeCoverageGroupingService,
  GroupingQueryInput,
} from './knowledge-coverage-grouping';
import {
  classifyQuery,
  applyHygieneOverride,
  CoverageCandidate,
  CoverageClassification,
  CoverageCuts,
} from './knowledge-coverage-causes';
import { resolveMark, MarkedTheme } from './knowledge-coverage-identity';

interface RoutedTurn {
  id: string;
  conversationId: string | null;
  agentType: AgentType;
  message: string;
  candidates: CoverageCandidate[] | null;
}

/** Un tema ya agregado, listo para persistir como una fila de `CoverageTheme`. */
interface AggregatedTheme {
  label: string;
  agentType: AgentType | null;
  band: CoverageBand;
  cause: CoverageCause | null;
  bestScore: number | null;
  documents: CoverageCandidate[];
  hygienePairId: string | null;
  queryEventIds: string[];
  resolvedEscalationIds: string[];
}

const CAUSE_PRIORITY: CoverageCause[] = [
  'SE_COMPITEN',
  'QUEDO_CORTO',
  'NO_HAY_NADA',
  'NO_ES_DEL_CORPUS',
  'INDETERMINADA',
];

/**
 * "Qué falta para responder mejor" (spec 009, US1).
 *
 * La corrida es un job de BullMQ, calcado de `KnowledgeHygieneService`
 * (spec 008): `startScan` crea la fila en `RUNNING` y encola; `runScan` —
 * llamado por `CoverageScanProcessor` fuera del request (Principio IV) —
 * hace el trabajo y termina en `READY` o `FAILED`, nunca a medias.
 *
 * `getLatest` es lo único que corre dentro de un request: es una lectura.
 */
@Injectable()
export class KnowledgeCoverageService {
  private readonly logger = new Logger(KnowledgeCoverageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue('coverage-scan') private readonly queue: Queue,
    private readonly grouping: KnowledgeCoverageGroupingService,
    private readonly knowledge: KnowledgeService,
  ) {}

  // ==========================================================================
  // Disparar la corrida
  // ==========================================================================

  async startScan(
    startedById: string,
    windowFromInput?: Date,
    windowToInput?: Date,
  ) {
    const yaCorriendo = await this.prisma.coverageScan.findFirst({
      where: { status: CoverageScanStatus.RUNNING },
    });
    if (yaCorriendo && !(await this.cerrarSiQuedoColgado(yaCorriendo))) {
      throw new ConflictException({
        statusCode: 409,
        reason: 'SCAN_ALREADY_RUNNING',
        scanId: yaCorriendo.id,
        message: 'Ya hay una corrida en curso. Esperá a que termine.',
      });
    }

    const { windowFrom, windowTo, truncatedWindow } = this.resolveWindow(
      windowFromInput,
      windowToInput,
    );

    const scan = await this.prisma.coverageScan.create({
      data: {
        status: CoverageScanStatus.RUNNING,
        windowFrom,
        windowTo,
        noiseFloor: this.config.get<number>('COVERAGE_NOISE_FLOOR')!,
        threshold: this.umbralEnPorcentaje(),
        marginalBand: this.config.get<number>('COVERAGE_MARGINAL_BAND')!,
        startedById,
      },
    });

    await this.queue.add('scan', { scanId: scan.id });

    return {
      scanId: scan.id,
      status: scan.status,
      windowFrom,
      windowTo,
      truncatedWindow,
    };
  }

  /**
   * ⚠️ Un barrido puede quedar `RUNNING` **sin que nadie lo esté ejecutando**:
   * si el worker se reinicia a mitad de la corrida, el job muere sin pasar por
   * el `catch` de `runScan`, que es lo único que deja la fila en `FAILED`.
   *
   * Como este barrido es **global**, el 409 eterno no bloquea un área: bloquea
   * **las cinco**. Se vio en la pantalla de mejoras (spec 011), donde el botón
   * "Actualizar" quedó deshabilitado en todas — no se dedujo, se miró.
   *
   * Se marca `FAILED` con motivo en vez de borrarlo en silencio: que se cayó
   * es información.
   *
   * @returns `true` si estaba colgado y se cerró — o sea, se puede arrancar
   *   uno nuevo.
   */
  private async cerrarSiQuedoColgado(scan: {
    id: string;
    createdAt: Date;
  }): Promise<boolean> {
    const minutos = this.config.get<number>('COVERAGE_SCAN_STALE_MINUTES')!;
    if (!estaColgado(scan.createdAt, minutos)) return false;

    this.logger.warn(
      `El barrido ${scan.id} quedó colgado más de ${minutos} min: se cierra ` +
        `como FAILED y se arranca uno nuevo`,
    );
    await this.prisma.coverageScan.update({
      where: { id: scan.id },
      data: {
        status: CoverageScanStatus.FAILED,
        failureReason: motivoColgado(minutos),
        finishedAt: new Date(),
      },
    });
    return true;
  }

  /**
   * FR-025: ventana inválida se rechaza o se acota, con aviso — nunca se
   * devuelve algo que parezca calculado sobre lo pedido.
   */
  private resolveWindow(
    windowFromInput?: Date,
    windowToInput?: Date,
  ): { windowFrom: Date; windowTo: Date; truncatedWindow: boolean } {
    const windowDays = this.config.get<number>('COVERAGE_WINDOW_DAYS')!;
    const now = new Date();

    let windowTo = windowToInput ?? now;
    let truncatedWindow = false;
    if (windowTo > now) {
      windowTo = now;
      truncatedWindow = true;
    }

    const windowFrom =
      windowFromInput ??
      new Date(windowTo.getTime() - windowDays * 24 * 60 * 60 * 1000);

    if (windowFrom >= windowTo) {
      throw new BadRequestException({
        statusCode: 400,
        reason: 'INVALID_WINDOW',
        message:
          'La ventana pedida es inválida: el inicio no es anterior al fin.',
      });
    }

    return { windowFrom, windowTo, truncatedWindow };
  }

  private umbralEnPorcentaje(): number {
    return this.config.get<number>('RAG_CONFIDENCE_THRESHOLD')! * 100;
  }

  // ==========================================================================
  // La corrida en sí (fuera del request — la llama CoverageScanProcessor)
  // ==========================================================================

  async runScan(scanId: string): Promise<void> {
    try {
      const scan = await this.prisma.coverageScan.findUniqueOrThrow({
        where: { id: scanId },
      });

      const cuts: CoverageCuts = {
        noiseFloor: scan.noiseFloor,
        threshold: scan.threshold,
        marginalBand: scan.marginalBand,
      };

      const minQueriesPerTheme = this.config.get<number>(
        'COVERAGE_MIN_QUERIES_PER_THEME',
      )!;
      const maxQueriesPerScan = this.config.get<number>(
        'COVERAGE_MAX_QUERIES_PER_SCAN',
      )!;
      const overlapCut = this.config.get<number>('COVERAGE_THEME_OVERLAP')!;

      const { turns, truncated } = await this.fetchTurns(
        scan.windowFrom,
        scan.windowTo,
        maxQueriesPerScan,
      );

      // FR-003a: por debajo del mínimo GLOBAL (los cinco agentes juntos),
      // no se agrupa ni se muestra nada — y no vale la pena gastar la
      // llamada de chat para producirlo. `getLatest` distingue este caso
      // (SIN_MUESTRA_SUFICIENTE) comparando `queriesConsidered` al leer.
      const scanMinQueries = this.config.get<number>(
        'COVERAGE_SCAN_MIN_QUERIES',
      )!;
      if (turns.length < scanMinQueries) {
        await this.prisma.coverageScan.update({
          where: { id: scanId },
          data: {
            status: CoverageScanStatus.READY,
            queriesConsidered: turns.length,
            looseQueries: 0,
            themesFound: 0,
            truncated,
            finishedAt: new Date(),
          },
        });
        this.logger.log(
          `Corrida ${scanId}: ${turns.length} consultas, por debajo del mínimo (${scanMinQueries}) — sin agrupar`,
        );
        return;
      }

      const hygienePairPorDocumento = await this.fetchOpenHygienePairs();
      const previousLabels = await this.fetchPreviousLabels(scanId);
      const marcados = await this.fetchMarkedThemes(scanId);

      // Solo van al agrupador las consultas "de interés": las que
      // `classifyQuery` NO descarta por haber contestado holgado. El valor
      // de `esPreguntaDeConocimiento` acá es un placeholder — no cambia si
      // el resultado es `null`, solo qué causa tendría si no lo fuera.
      const deInteres = turns.filter(
        (t) =>
          classifyQuery(
            { candidates: t.candidates, esPreguntaDeConocimiento: true },
            cuts,
          ) !== null,
      );

      const groupingInput: GroupingQueryInput[] = deInteres.map((t) => ({
        id: t.id,
        text: t.message,
      }));
      const { themes: gruposLlm, sinAgrupar } = await this.grouping.group(
        groupingInput,
        previousLabels,
        minQueriesPerTheme,
      );

      const turnosPorId = new Map(deInteres.map((t) => [t.id, t]));
      const aggregated = this.buildAggregatedThemes(
        gruposLlm,
        turnosPorId,
        cuts,
        hygienePairPorDocumento,
      );

      // FR-026/FR-027: los temas ya marcados como atendidos, sin tráfico
      // nuevo, se ocultan — no se persisten en esta corrida.
      const aMostrar = await this.filterHandled(
        aggregated,
        marcados,
        overlapCut,
      );

      await this.persist(scanId, aMostrar);

      await this.prisma.coverageScan.update({
        where: { id: scanId },
        data: {
          status: CoverageScanStatus.READY,
          queriesConsidered: turns.length,
          looseQueries: sinAgrupar.length,
          themesFound: aMostrar.length,
          truncated,
          finishedAt: new Date(),
        },
      });

      this.logger.log(
        `Corrida ${scanId}: ${turns.length} consultas, ${aMostrar.length} temas, ${sinAgrupar.length} sueltas`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Corrida ${scanId} falló: ${message}`);
      // Una corrida a medias NUNCA se muestra como completa.
      await this.prisma.coverageScan.update({
        where: { id: scanId },
        data: {
          status: CoverageScanStatus.FAILED,
          failureReason: message,
          finishedAt: new Date(),
        },
      });
      throw err;
    }
  }

  private async fetchTurns(
    windowFrom: Date,
    windowTo: Date,
    cap: number,
  ): Promise<{ turns: RoutedTurn[]; truncated: boolean }> {
    const total = await this.prisma.orchestrationEvent.count({
      where: {
        eventType: 'ROUTED_TO_AGENT',
        agentType: { not: null },
        createdAt: { gte: windowFrom, lt: windowTo },
      },
    });

    const rows = await this.prisma.orchestrationEvent.findMany({
      where: {
        eventType: 'ROUTED_TO_AGENT',
        agentType: { not: null },
        createdAt: { gte: windowFrom, lt: windowTo },
      },
      orderBy: { createdAt: 'desc' },
      take: cap,
      select: {
        id: true,
        conversationId: true,
        agentType: true,
        payload: true,
      },
    });

    const turns: RoutedTurn[] = rows.map((r) => {
      const payload = r.payload as Record<string, unknown>;
      const candidates =
        'candidates' in payload
          ? (payload.candidates as CoverageCandidate[] | null)
          : null;
      return {
        id: r.id,
        conversationId: r.conversationId,
        agentType: r.agentType!,
        message: String(payload.message ?? ''),
        candidates,
      };
    });

    return { turns, truncated: total > cap };
  }

  /**
   * D3: el cruce contra higiene del corpus (spec 008) se resuelve con la
   * última corrida `READY` de `HygieneScan`, sin importar si alguna pareja
   * fue descartada — un descarte dice "no fusionar TODAVÍA", no "el
   * solapamiento dejó de existir".
   */
  private async fetchOpenHygienePairs(): Promise<
    Map<string, { pairId: string; otherDocumentId: string }>
  > {
    const ultima = await this.prisma.hygieneScan.findFirst({
      where: { status: 'READY' },
      orderBy: { createdAt: 'desc' },
    });
    if (!ultima) return new Map();

    const pares = await this.prisma.hygienePair.findMany({
      where: { scanId: ultima.id },
      select: { id: true, documentAId: true, documentBId: true },
    });

    const map = new Map<string, { pairId: string; otherDocumentId: string }>();
    for (const p of pares) {
      map.set(p.documentAId, { pairId: p.id, otherDocumentId: p.documentBId });
      map.set(p.documentBId, { pairId: p.id, otherDocumentId: p.documentAId });
    }
    return map;
  }

  private async fetchPreviousLabels(excludeScanId: string): Promise<string[]> {
    const previa = await this.prisma.coverageScan.findFirst({
      where: { status: CoverageScanStatus.READY, id: { not: excludeScanId } },
      orderBy: { createdAt: 'desc' },
    });
    if (!previa) return [];

    const temas = await this.prisma.coverageTheme.findMany({
      where: { scanId: previa.id },
      select: { label: true },
      distinct: ['label'],
    });
    return temas.map((t) => t.label);
  }

  private async fetchMarkedThemes(
    excludeScanId: string,
  ): Promise<MarkedTheme[]> {
    const marcas = await this.prisma.coverageThemeMark.findMany({
      where: { theme: { scanId: { not: excludeScanId } } },
      select: {
        markedAt: true,
        theme: { select: { id: true, queryEventIds: true } },
      },
    });
    return marcas.map((m) => ({
      themeId: m.theme.id,
      queryEventIds: m.theme.queryEventIds,
      markedAt: m.markedAt,
    }));
  }

  /**
   * Clasifica cada consulta de cada tema propuesto por el agrupador y las
   * agrega en filas persistibles. Un grupo del LLM puede terminar en MÁS de
   * una fila: si sus consultas caen en bandas o agentes distintos, se
   * separan (edge case de spec.md: "un mismo tema bajo dos agentes distintos
   * NO se decide acá, se muestra bajo los dos").
   */
  private buildAggregatedThemes(
    gruposLlm: {
      label: string;
      queryIds: string[];
      esPreguntaDeConocimiento: boolean;
    }[],
    turnosPorId: Map<string, RoutedTurn>,
    cuts: CoverageCuts,
    hygienePairPorDocumento: Map<
      string,
      { pairId: string; otherDocumentId: string }
    >,
  ): AggregatedTheme[] {
    const resultado: AggregatedTheme[] = [];

    for (const grupo of gruposLlm) {
      type Clasificado = {
        turn: RoutedTurn;
        classification: CoverageClassification & {
          hygienePairId: string | null;
        };
      };
      const subgrupos = new Map<string, Clasificado[]>();
      const agentesPorClave = new Map<string, AgentType>();

      for (const id of grupo.queryIds) {
        const turn = turnosPorId.get(id);
        if (!turn) continue; // ya filtrado por el agrupador, defensivo

        const base = classifyQuery(
          {
            candidates: turn.candidates,
            esPreguntaDeConocimiento: grupo.esPreguntaDeConocimiento,
          },
          cuts,
        );
        // No debería pasar (estas consultas ya son "de interés"), pero si
        // pasara, no forma parte de ningún tema.
        if (!base) continue;

        const clasificado = applyHygieneOverride(
          base,
          turn.candidates,
          hygienePairPorDocumento,
        )!;
        const clave = `${clasificado.band}::${turn.agentType}`;
        const lista = subgrupos.get(clave) ?? [];
        lista.push({ turn, classification: clasificado });
        subgrupos.set(clave, lista);
        agentesPorClave.set(clave, turn.agentType);
      }

      for (const [clave, miembros] of subgrupos) {
        const band = clave.split('::')[0] as CoverageBand;
        const agentType = agentesPorClave.get(clave)!;
        resultado.push(
          this.aggregateSubgroup(grupo.label, band, agentType, miembros),
        );
      }
    }

    return resultado;
  }

  private aggregateSubgroup(
    label: string,
    band: CoverageBand,
    agentType: AgentType,
    miembros: {
      turn: RoutedTurn;
      classification: CoverageClassification & { hygienePairId: string | null };
    }[],
  ): AggregatedTheme {
    // Causa: la de mayor prioridad entre las presentes (SE_COMPITEN >
    // QUEDO_CORTO > NO_HAY_NADA > NO_ES_DEL_CORPUS > INDETERMINADA). Si
    // CUALQUIER consulta del grupo prueba que hay un documento cerca, el
    // tema no puede terminar diciendo "no hay nada" (SC-001).
    const causasPresentes = new Set(
      miembros
        .map((m) => m.classification.cause)
        .filter((c): c is CoverageCause => c !== null),
    );
    const cause =
      band === 'AL_LIMITE'
        ? null
        : (CAUSE_PRIORITY.find((c) => causasPresentes.has(c)) ?? null);

    const scores = miembros
      .map((m) => m.classification.bestScore)
      .filter((s): s is number => s !== null);
    const bestScore = scores.length > 0 ? Math.max(...scores) : null;

    const documentosPorId = new Map<string, CoverageCandidate>();
    for (const m of miembros) {
      for (const doc of m.classification.documents) {
        const previo = documentosPorId.get(doc.documentId);
        if (!previo || doc.score > previo.score) {
          documentosPorId.set(doc.documentId, doc);
        }
      }
    }

    const hygienePairId =
      miembros.find((m) => m.classification.hygienePairId)?.classification
        .hygienePairId ?? null;

    return {
      label,
      agentType,
      band,
      cause,
      bestScore,
      documents: [...documentosPorId.values()],
      hygienePairId,
      queryEventIds: miembros.map((m) => m.turn.id),
      // FR-009a se resuelve en persist(), donde sí está disponible el
      // conversationId de cada turno (se pierde al agregar acá).
      resolvedEscalationIds: [],
    };
  }

  /**
   * FR-026/FR-027: aplica las marcas de "atendido". Un tema con marca y sin
   * consultas posteriores a `markedAt` se oculta; con consultas nuevas,
   * se muestra marcado como reincidente (la marca en sí se resuelve al leer,
   * acá solo se decide si se persiste).
   */
  private async filterHandled(
    temas: AggregatedTheme[],
    marcados: MarkedTheme[],
    overlapCut: number,
  ): Promise<AggregatedTheme[]> {
    if (marcados.length === 0 || temas.length === 0) return temas;

    // createdAt de cada evento, para saber si hay tráfico posterior a la marca.
    const idsRelevantes = temas.flatMap((t) => t.queryEventIds);
    const eventos = await this.prisma.orchestrationEvent.findMany({
      where: { id: { in: idsRelevantes } },
      select: { id: true, createdAt: true },
    });
    const fechaPorId = new Map(eventos.map((e) => [e.id, e.createdAt]));

    return temas.filter((tema) => {
      const match = resolveMark(tema.queryEventIds, marcados, overlapCut);
      if (!match) return true; // sin marca compatible: nuevo, se muestra

      const hayTraficoNuevo = tema.queryEventIds.some((id) => {
        const fecha = fechaPorId.get(id);
        return fecha ? fecha > match.markedAt : false;
      });
      return hayTraficoNuevo;
    });
  }

  private async persist(
    scanId: string,
    temas: AggregatedTheme[],
  ): Promise<void> {
    for (const tema of temas) {
      // Escalaciones resueltas de las conversaciones de este tema (FR-009a).
      const conversationIds = await this.prisma.orchestrationEvent.findMany({
        where: { id: { in: tema.queryEventIds } },
        select: { conversationId: true },
      });
      const convIds = [
        ...new Set(
          conversationIds
            .map((c) => c.conversationId)
            .filter((id): id is string => !!id),
        ),
      ];
      const escalaciones =
        convIds.length > 0
          ? await this.prisma.escalation.findMany({
              where: { conversationId: { in: convIds }, status: 'RESOLVED' },
              select: { id: true },
            })
          : [];

      // Versión vigente de cada documento señalado (FR-007: "esto cambió
      // desde que te lo indiqué" se calcula al leer, comparando contra esto).
      const docIds = tema.documents.map((d) => d.documentId);
      const docsActuales =
        docIds.length > 0
          ? await this.prisma.knowledgeDocument.findMany({
              where: { id: { in: docIds } },
              select: { id: true, version: true },
            })
          : [];
      const versionPorDoc = new Map(docsActuales.map((d) => [d.id, d.version]));

      await this.prisma.coverageTheme.create({
        data: {
          scanId,
          label: tema.label,
          agentType: tema.agentType,
          band: tema.band,
          cause: tema.cause,
          bestScore: tema.bestScore,
          queryEventIds: tema.queryEventIds,
          queryCount: tema.queryEventIds.length,
          hygienePairId: tema.hygienePairId,
          resolvedEscalationIds: escalaciones.map((e) => e.id),
          documents: {
            create: tema.documents.map((d) => ({
              documentId: d.documentId,
              score: d.score,
              version: versionPorDoc.get(d.documentId) ?? 1,
            })),
          },
        },
      });
    }
  }

  // ==========================================================================
  // Lectura — corre dentro del request, es una lectura simple (T019-T021)
  // ==========================================================================

  /**
   * `GET /knowledge/coverage/latest`. Solo la última corrida (FR-013
   * acotado, igual que `HygieneScan` en la spec 008): no hay endpoint para
   * corridas anteriores.
   */
  /**
   * Spec 011: ¿hay un barrido en curso? Lo usa la pantalla unificada para
   * decir "estoy trabajando" (FR-013). El barrido es global, así que la
   * pregunta no lleva área.
   */
  async hayScanCorriendo(): Promise<boolean> {
    const n = await this.prisma.coverageScan.count({
      where: { status: CoverageScanStatus.RUNNING },
    });
    return n > 0;
  }

  async getLatest(employeeId: string) {
    const ultima = await this.prisma.coverageScan.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!ultima) {
      return {
        scan: null,
        themes: [],
        notice: { code: 'SIN_CORRIDA' as const },
      };
    }

    if (ultima.status !== CoverageScanStatus.READY) {
      // RUNNING o FAILED: no hay temas que mostrar todavía (o la corrida no
      // llegó a persistir nada). No se inventa un estado intermedio.
      return {
        scan: {
          id: ultima.id,
          status: ultima.status,
          windowFrom: ultima.windowFrom,
          windowTo: ultima.windowTo,
          finishedAt: ultima.finishedAt,
          failureReason: ultima.failureReason,
        },
        themes: [],
        notice: null,
      };
    }

    const scanMinQueries = this.config.get<number>(
      'COVERAGE_SCAN_MIN_QUERIES',
    )!;
    if (ultima.queriesConsidered < scanMinQueries) {
      return {
        scan: this.scanEnvelope(ultima),
        themes: [],
        notice: {
          code: 'SIN_MUESTRA_SUFICIENTE' as const,
          queriesInWindow: ultima.queriesConsidered,
          minimumSample: scanMinQueries,
          windowDays: this.config.get<number>('COVERAGE_WINDOW_DAYS')!,
        },
      };
    }

    const temas = await this.prisma.coverageTheme.findMany({
      where: { scanId: ultima.id },
      orderBy: { queryCount: 'desc' },
      include: {
        documents: { include: { document: true } },
        mark: { include: { markedBy: { select: { id: true, name: true } } } },
      },
    });

    if (temas.length === 0) {
      return {
        scan: this.scanEnvelope(ultima),
        themes: [],
        notice: { code: 'TODO_CUBIERTO' as const },
      };
    }

    // Marcas de CUALQUIER corrida anterior, con quién marcó — para el caso
    // "reincidente" (FR-027): un tema nuevo no tiene `mark` propio (la marca
    // quedó en el tema VIEJO al que reemplaza), así que "¿esto ya se había
    // marcado?" se resuelve acá por solape, igual que `filterHandled` en
    // `runScan` — la diferencia es que acá el resultado es solo para
    // MOSTRAR, la decisión de ocultar u no ya se tomó al persistir.
    const marcasPasadas = await this.fetchMarksWithNames(ultima.id);
    const overlapCut = this.config.get<number>('COVERAGE_THEME_OVERLAP')!;

    const themes = await Promise.all(
      temas.map((t) =>
        this.themeView(t, employeeId, marcasPasadas, overlapCut),
      ),
    );

    return { scan: this.scanEnvelope(ultima), themes, notice: null };
  }

  private async fetchMarksWithNames(excludeScanId: string) {
    const marcas = await this.prisma.coverageThemeMark.findMany({
      where: { theme: { scanId: { not: excludeScanId } } },
      select: {
        markedAt: true,
        markedBy: { select: { id: true, name: true } },
        theme: { select: { id: true, queryEventIds: true } },
      },
    });
    return marcas.map((m) => ({
      themeId: m.theme.id,
      queryEventIds: m.theme.queryEventIds,
      markedAt: m.markedAt,
      markedBy: m.markedBy,
    }));
  }

  private scanEnvelope(scan: {
    id: string;
    status: CoverageScanStatus;
    windowFrom: Date;
    windowTo: Date;
    finishedAt: Date | null;
    queriesConsidered: number;
    looseQueries: number;
    themesFound: number;
    truncated: boolean;
    noiseFloor: number;
    threshold: number;
    marginalBand: number;
  }) {
    return {
      id: scan.id,
      status: scan.status,
      windowFrom: scan.windowFrom,
      windowTo: scan.windowTo,
      finishedAt: scan.finishedAt,
      queriesConsidered: scan.queriesConsidered,
      looseQueries: scan.looseQueries,
      themesFound: scan.themesFound,
      truncated: scan.truncated,
      noiseFloor: scan.noiseFloor,
      threshold: scan.threshold,
      marginalBand: scan.marginalBand,
    };
  }

  /** Arma la vista de UN tema para `getLatest` — citas, área, y `canMarkHandled`. */
  private async themeView(
    tema: Awaited<
      ReturnType<typeof this.prisma.coverageTheme.findMany>
    >[number] & {
      documents: {
        score: number;
        version: number;
        document: {
          id: string;
          title: string;
          isActive: boolean;
          version: number;
        };
      }[];
      mark: { markedAt: Date; markedBy: { id: string; name: string } } | null;
    },
    employeeId: string,
    marcasPasadas: {
      themeId: string;
      queryEventIds: string[];
      markedAt: Date;
      markedBy: { id: string; name: string };
    }[],
    overlapCut: number,
  ) {
    // FR-006: el área se resuelve por Sector.agentType — no hay campo de
    // área propio en CoverageTheme (data-model.md).
    const sector = tema.agentType
      ? await this.prisma.sector.findFirst({
          where: { agentType: tema.agentType },
          include: { supervisores: { select: { id: true, name: true } } },
        })
      : null;

    // FR-027: este tema puede ser nuevo de verdad, o la REAPARICIÓN de uno
    // marcado en una corrida anterior — la marca quedó en la fila VIEJA, que
    // ya no se muestra. Si `tema.mark` (directo, spec 009 US1) no está, se
    // busca por solape contra marcas de corridas previas: si aparece, esta
    // fila YA pasó el filtro de `runScan` (tenía tráfico posterior a esa
    // marca), así que encontrarla acá es, por construcción, "reincidente".
    const reincidencia = tema.mark
      ? null
      : resolveMark(tema.queryEventIds, marcasPasadas, overlapCut);
    const marcaEfectiva = tema.mark
      ? {
          markedAt: tema.mark.markedAt,
          markedBy: tema.mark.markedBy,
          recurring: false,
        }
      : reincidencia
        ? {
            markedAt: reincidencia.markedAt,
            markedBy: marcasPasadas.find(
              (m) => m.themeId === reincidencia.themeId,
            )!.markedBy,
            recurring: true,
          }
        : null;

    const canMarkHandled = tema.mark
      ? false // ya está marcado; se desmarca, no se vuelve a marcar
      : await this.knowledge.esResponsableDeAgente(employeeId, tema.agentType);

    // FR-009: citas acotadas, sin identificar a quién preguntó.
    const maxQuotes = this.config.get<number>('COVERAGE_MAX_QUOTES_PER_THEME')!;
    const eventos = await this.prisma.orchestrationEvent.findMany({
      where: { id: { in: tema.queryEventIds } },
      select: { payload: true },
      take: maxQuotes,
    });
    const quotes = eventos.map((e) =>
      String((e.payload as Record<string, unknown>).message ?? ''),
    );

    // FR-009a/FR-009b: resoluciones humanas, de solo lectura.
    const resolvedEscalations =
      tema.resolvedEscalationIds.length > 0
        ? await this.prisma.escalation.findMany({
            where: { id: { in: tema.resolvedEscalationIds } },
            select: { id: true, resolution: true, resolvedAt: true },
          })
        : [];

    return {
      id: tema.id,
      label: tema.label,
      agentType: tema.agentType,
      area: sector
        ? { name: sector.name, responsables: sector.supervisores }
        : null,
      band: tema.band,
      cause: tema.cause,
      action: this.deriveAction(tema.cause, tema.band, tema.documents.length),
      queryCount: tema.queryCount,
      bestScore: tema.bestScore,
      documents: tema.documents.map((d) => ({
        id: d.document.id,
        title: d.document.title,
        score: d.score,
        version: d.version,
        isActive: d.document.isActive,
        changedSinceScan: d.document.version !== d.version,
      })),
      quotes,
      // Spec 010: la entrevista necesita reconocer, entre sesiones, si un
      // tema ya se preguntó — por solapamiento de sus consultas, la misma
      // identidad que sostiene FR-028/D6 acá arriba. No es una regla nueva
      // ni un dato más sensible que `quotes` (que ya deriva su texto de
      // estos mismos ids); es la clave que faltaba exponer para reusarla.
      queryEventIds: tema.queryEventIds,
      resolvedEscalations,
      handled: marcaEfectiva,
      canMarkHandled,
    };
  }

  private deriveAction(
    cause: CoverageCause | null,
    band: CoverageBand,
    documentCount: number,
  ):
    | 'CARGAR'
    | 'CORREGIR_DOCUMENTO'
    | 'REVISAR_HIGIENE'
    | 'NINGUNA'
    | 'DERIVAR' {
    // AL_LIMITE con documento detrás: contestó, pero por pocos puntos. Se
    // propone corregir ESE documento — es el mismo veredicto que
    // `elegirForma` (spec 010, D1) sobre el mismo tema. Decía `NINGUNA`, y
    // eso hacía que el panel y la entrevista se contradijeran: uno decía
    // "no hagas nada" sobre lo que el otro mandaba a corregir.
    // Sin documento no hay nada que corregir, así que ahí sí no hay acción.
    if (band === 'AL_LIMITE') {
      return documentCount > 0 ? 'CORREGIR_DOCUMENTO' : 'NINGUNA';
    }
    switch (cause) {
      case 'NO_HAY_NADA':
        return 'CARGAR';
      case 'QUEDO_CORTO':
        return 'CORREGIR_DOCUMENTO';
      case 'SE_COMPITEN':
        return 'REVISAR_HIGIENE';
      default:
        return 'NINGUNA';
    }
  }

  // ==========================================================================
  // Atendido y reaparición (spec 009, FR-026..FR-029)
  // ==========================================================================

  // ⚠️ `markHandled`/`unmarkHandled` **se retiraron** en la spec 011: los
  // reemplaza el descarte unificado, que sirve para las tres fuentes de la
  // pantalla de mejoras y no solo para los temas de cobertura (FR-024a).
  // Sostener dos mecanismos que hacen lo mismo era el ruido que aquella spec
  // vino a sacar.
  //
  // **`CoverageThemeMark` NO se retira**: deja de escribirse pero se sigue
  // leyendo, acá en `filterHandled` y en el filtro de la lista unificada
  // (FR-024b). Borrar esa lectura obligaría a la gente a volver a descartar lo
  // que ya descartó.
}
