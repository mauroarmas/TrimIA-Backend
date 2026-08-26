import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentType, EscalationStatus, ImprovementSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { KnowledgeCoverageService } from '../ai/knowledge/knowledge-coverage.service';
import {
  materialDeEscalados,
  EscaladoParaMaterial,
} from '../interviews/interviews-fallback';
import {
  MaterialDePregunta,
  excluirPorCausa,
} from '../interviews/interviews-questions';
import {
  ItemParaMejorar,
  DescarteVigente,
  PreguntaPrevia,
  armarLista,
  PREFIJO,
} from './improvements-list';
import { DocumentReviewService } from './document-review.service';

export type NoticeCode = 'SIN_REVISAR' | 'TODO_CUBIERTO' | 'SIN_DOCUMENTOS';

/**
 * Spec 011 — la lista unificada de qué mejorar en un área.
 *
 * Consume `KnowledgeCoverageService` (spec 009), los escalados (spec 010) y el
 * detector de esta spec. **No importa `InterviewsModule`**: lo que necesita
 * saber de la entrevista —qué se preguntó ya— lo lee de `InterviewQuestion`
 * por Prisma. La dependencia va al revés, y así no hay ciclo.
 */
@Injectable()
export class ImprovementsService {
  private readonly logger = new Logger(ImprovementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly knowledge: KnowledgeService,
    private readonly coverage: KnowledgeCoverageService,
    private readonly documentReview: DocumentReviewService,
  ) {}

  /** Área + verificación de responsabilidad. Rechaza antes de tocar nada. */
  private async cargarArea(sectorId: string, empleadoId: string) {
    const sector = await this.prisma.sector.findUnique({
      where: { id: sectorId },
    });
    if (!sector) throw new NotFoundException('Área no encontrada');
    if (!sector.agentType) {
      throw new BadRequestException(
        'Esta área no tiene agente asociado; no hay documentos que revisar',
      );
    }
    const permitido = await this.knowledge.esResponsableDeAgente(
      empleadoId,
      sector.agentType,
    );
    if (!permitido) {
      throw new ForbiddenException('No sos responsable de esta área');
    }
    return { sector, agentType: sector.agentType };
  }

  /**
   * FR-005a: **una sola acción** dispara los dos análisis. Quien la usa no
   * tiene por qué saber que detrás son dos.
   *
   * Los dos se enganchan en vez de rechazar cuando ya hay uno corriendo
   * (FR-018): fallar el request entero porque uno de los dos ya estaba
   * cancelaría también el otro, que sí podía arrancar.
   */
  async refresh(sectorId: string, empleadoId: string) {
    const { sector, agentType } = await this.cargarArea(sectorId, empleadoId);

    // FR-005b: el barrido de cobertura es GLOBAL. Dispararlo desde Ventas
    // también actualiza lo de Cobranzas, y dos personas de áreas distintas
    // comparten la corrida. No es un error: su mínimo de muestra cuenta el
    // tráfico de los cinco agentes juntos, así que acotarlo al área cambiaría
    // cuándo hay muestra suficiente — una regla ya establecida y medida.
    let coverage: { scanId: string; status: string; reused: boolean };
    try {
      const scan = await this.coverage.startScan(empleadoId);
      coverage = { scanId: scan.scanId, status: scan.status, reused: false };
    } catch (err) {
      const enCurso = this.scanIdDelConflicto(err);
      if (!enCurso) throw err;
      coverage = { scanId: enCurso, status: 'RUNNING', reused: true };
    }

    const documents = await this.documentReview.startReview(
      sector.id,
      agentType,
      empleadoId,
    );

    return { sectorId: sector.id, coverage, documents };
  }

  /** El 409 de `startScan` trae el `scanId` en curso; acá se convierte en enganche. */
  private scanIdDelConflicto(err: unknown): string | null {
    const respuesta = (err as { getResponse?: () => unknown })?.getResponse?.();
    if (respuesta && typeof respuesta === 'object') {
      const r = respuesta as { reason?: string; scanId?: string };
      if (r.reason === 'SCAN_ALREADY_RUNNING' && r.scanId) return r.scanId;
    }
    return null;
  }

  /** `GET /improvements` — la pantalla entera en una llamada. */
  async list(sectorId: string, empleadoId: string) {
    const { sector, agentType } = await this.cargarArea(sectorId, empleadoId);

    const [
      crudos,
      ultimaRevision,
      scanCorriendo,
      documentosDelArea,
      sesionAbierta,
    ] = await Promise.all([
      this.itemsCrudos(sector.id, agentType, empleadoId),
      this.documentReview.ultimaRevision(sector.id),
      this.coverage.hayScanCorriendo(),
      this.prisma.knowledgeDocument.count({
        where: { isActive: true, OR: [{ agentType }, { agentType: null }] },
      }),
      this.sesionSinCerrar(sector.id, empleadoId),
    ]);

    const items = await this.filtrarYCortar(crudos, sector.id, agentType);
    const revisando = await this.documentReview.hayRevisionCorriendo(sector.id);

    return {
      sector: { id: sector.id, name: sector.name },
      refreshing: revisando || scanCorriendo,
      lastRefresh: ultimaRevision
        ? {
            at: ultimaRevision.finishedAt ?? ultimaRevision.createdAt,
            documentsAnalyzed: ultimaRevision.documentsAnalyzed,
            documentsSkipped: ultimaRevision.documentsSkipped,
            queriesConsidered: await this.consultasDeLaUltimaCorrida(),
          }
        : null,
      items,
      // Una entrevista sin cerrar de esta persona en esta área. Va acá y no en
      // un endpoint propio porque esta pantalla es la única puerta a la
      // entrevista desde que se retiró su pestaña: sin este dato, una sesión
      // con fichas esperando aprobación queda **inalcanzable** en cuanto la
      // lista se vacía. Encontrado mirando el panel, no el código.
      openSession: sesionAbierta,
      notice: this.notice(items.length, ultimaRevision, documentosDelArea),
    };
  }

  /** La sesión sin cerrar de esta persona en esta área, si la hay (FR-003). */
  private async sesionSinCerrar(sectorId: string, empleadoId: string) {
    const sesion = await this.prisma.interviewSession.findFirst({
      where: {
        sectorId,
        openedById: empleadoId,
        status: {
          in: ['PREPARANDO', 'EN_CURSO', 'CERRANDO', 'EN_REVISION'],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    return sesion ?? null;
  }

  /**
   * Los tres `notice` **no son intercambiables** aunque los tres den
   * `items: []`. "Nunca se revisó" y "se revisó y está bien" piden acciones
   * distintas, y ofrecer revisar un área sin documentos es mentir.
   *
   * ⚠️ `SIN_MUESTRA_SUFICIENTE` **no se propaga**: el servicio de cobertura lo
   * devuelve, pero acá ya no significa "no hay nada que mejorar" — las otras
   * dos fuentes no dependen del tráfico, así que esa fuente aporta cero ítems
   * y la lista sigue viva.
   */
  private notice(
    cantidad: number,
    ultimaRevision: { id: string } | null,
    documentosDelArea: number,
  ): { code: NoticeCode } | null {
    if (cantidad > 0) return null;
    if (documentosDelArea === 0) return { code: 'SIN_DOCUMENTOS' };
    if (!ultimaRevision) return { code: 'SIN_REVISAR' };
    return { code: 'TODO_CUBIERTO' };
  }

  private async consultasDeLaUltimaCorrida(): Promise<number> {
    const scan = await this.prisma.coverageScan.findFirst({
      where: { status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { queriesConsidered: true },
    });
    return scan?.queriesConsidered ?? 0;
  }

  // ==========================================================================
  // Las tres fuentes
  // ==========================================================================

  private async itemsCrudos(
    sectorId: string,
    agentType: AgentType,
    empleadoId: string,
  ): Promise<ItemParaMejorar[]> {
    const [temas, escalados, documentos] = await Promise.all([
      this.fuenteCobertura(agentType, empleadoId),
      this.fuenteEscalados(agentType),
      this.fuenteDocumentos(sectorId, agentType, empleadoId),
    ]);
    return [...temas, ...escalados, ...documentos];
  }

  /**
   * Primera fuente: los temas del resumen de cobertura (spec 009).
   *
   * FR-011: se excluyen los temas cuya causa son documentos que compiten.
   * Preguntar ahí agrega un tercero al conflicto; eso se resuelve fusionando y
   * ya tiene su propia pantalla.
   */
  private async fuenteCobertura(
    agentType: AgentType,
    empleadoId: string,
  ): Promise<ItemParaMejorar[]> {
    const latest = await this.coverage.getLatest(empleadoId);
    if (!latest.scan || latest.themes.length === 0) return [];

    const temas = latest.themes.filter((t) => t.agentType === agentType);
    if (temas.length === 0) return [];

    // Las fechas de las consultas: sin ellas no se puede decidir si un
    // descarte sigue valiendo o si llegó tráfico nuevo (FR-026a).
    const todosLosIds = temas.flatMap((t) => t.queryEventIds);
    const eventos = await this.prisma.orchestrationEvent.findMany({
      where: { id: { in: todosLosIds } },
      select: { id: true, createdAt: true },
    });
    const fechaPorId = new Map(eventos.map((e) => [e.id, e.createdAt]));

    return temas
      .filter(
        (t) =>
          !excluirPorCausa({
            origin: 'TEMA_COBERTURA',
            themeId: t.id,
            label: t.label,
            agentType: t.agentType,
            band: t.band,
            cause: t.cause,
            queryEventIds: t.queryEventIds,
            quotes: t.quotes,
            queryCount: t.queryCount,
            documents: [],
          }),
      )
      .map((t): ItemParaMejorar => {
        const documentosActivos = t.documents.filter((d) => d.isActive);
        const doc = documentosActivos[0];
        return {
          // El material completo, tal como la entrevista sabe preguntarlo. Se
          // guarda armado en vez de reconstruirse después: banda y causa no se
          // muestran en la lista, y reconstruir desde lo mostrado las perdería
          // en silencio — con ellas se decide la FORMA de la pregunta (SC-001).
          materialOriginal: {
            origin: 'TEMA_COBERTURA',
            themeId: t.id,
            label: t.label,
            agentType: t.agentType,
            band: t.band,
            cause: t.cause,
            queryEventIds: t.queryEventIds,
            quotes: t.quotes,
            queryCount: t.queryCount,
            documents: documentosActivos.map((d) => ({
              id: d.id,
              title: d.title,
              version: d.version,
              isActive: d.isActive,
            })),
          },
          id: `${PREFIJO.CONSULTA_FALLIDA}:${t.id}`,
          source: ImprovementSource.CONSULTA_FALLIDA,
          title: t.label,
          evidence: `${t.queryCount} ${
            t.queryCount === 1 ? 'consulta quedó' : 'consultas quedaron'
          } sin respuesta firme`,
          document: doc
            ? {
                id: doc.id,
                title: doc.title,
                version: doc.version,
                esTransversal: false,
              }
            : undefined,
          quotes: t.quotes,
          canInterview: true,
          canDismiss: true,
          queryCount: t.queryCount,
          themeQueryEventIds: t.queryEventIds,
          queryDates: t.queryEventIds
            .map((id) => fechaPorId.get(id))
            .filter((f): f is Date => f != null),
        };
      });
  }

  /**
   * Segunda fuente: los escalados **históricos** sin capitalizar (FR-009).
   *
   * Deja de ser respaldo condicionado a que no haya temas (FR-008): ahora
   * entra siempre, en paralelo con las otras dos. La lógica de "sin
   * capitalizar" se reusa de `materialDeEscalados` (spec 010), no se
   * reimplementa.
   */
  private async fuenteEscalados(
    agentType: AgentType,
  ): Promise<ItemParaMejorar[]> {
    const material = await this.materialDeEscaladosDelArea(agentType);
    return material.map((m): ItemParaMejorar => {
      const esPendiente = m.origin === 'ESCALADO_PENDIENTE';
      const escalationId =
        m.origin === 'ESCALADO_PENDIENTE' ||
        m.origin === 'ESCALADO_SIN_CAPITALIZAR'
          ? m.escalationId
          : '';
      return {
        materialOriginal: m,
        id: `${PREFIJO.ESCALADO}:${escalationId}`,
        source: ImprovementSource.ESCALADO,
        title: esPendiente
          ? (m.quotes[0] ?? 'Caso escalado sin responder')
          : 'Caso resuelto que nunca se guardó como conocimiento',
        evidence: esPendiente
          ? 'un caso que nadie contestó todavía'
          : 'se resolvió a mano y no quedó en la base',
        quotes: esPendiente ? m.quotes : undefined,
        canInterview: true,
        canDismiss: true,
        escalationId,
      };
    });
  }

  /**
   * FR-013c/e (spec 010): el área se asocia por `currentAgent` de la
   * conversación — `Escalation` no guarda `agentType` propio.
   *
   * Vino tal cual de `InterviewsService.resolverMaterialDeRespaldo`, que se
   * retiró: los escalados dejaron de ser respaldo.
   */
  private async materialDeEscaladosDelArea(
    agentType: AgentType,
  ): Promise<MaterialDePregunta[]> {
    const tope = this.config.get<number>('INTERVIEW_MAX_ESCALATIONS_FALLBACK')!;

    const escalados = await this.prisma.escalation.findMany({
      where: {
        conversation: { currentAgent: agentType },
        status: { in: [EscalationStatus.RESOLVED, EscalationStatus.PENDING] },
      },
      orderBy: { createdAt: 'desc' },
      take: tope,
      select: {
        id: true,
        status: true,
        resolution: true,
        resolvedWithDocumentId: true,
        conversationId: true,
        createdAt: true,
      },
    });
    if (escalados.length === 0) return [];

    const ids = escalados.map((e) => e.id);

    // Señal 2: documento creado enseñando al agente (spec 005) o al guardar
    // sin enviar (spec 007) — ninguno toca `resolvedWithDocumentId`.
    const documentosCapitalizados =
      await this.prisma.knowledgeDocument.findMany({
        where: { sourceType: 'ESCALADO', sourceId: { in: ids } },
        select: { sourceId: true },
      });
    const capitalizadosPorDocumento = new Set(
      documentosCapitalizados.map((d) => d.sourceId!),
    );

    // Señal 3: ya cerrado por la entrevista.
    const candidatosAprobados = await this.prisma.interviewCandidate.findMany({
      where: { status: 'APROBADO', question: { escalationId: { in: ids } } },
      select: { question: { select: { escalationId: true } } },
    });
    const capitalizadosPorEntrevista = new Set(
      candidatosAprobados.map((c) => c.question.escalationId!),
    );

    // La consulta original de los PENDING: el último mensaje del usuario antes
    // de escalar (`Escalation.reason` es diagnóstico del sistema, no la
    // consulta).
    const pendientes = escalados.filter(
      (e) => e.status === EscalationStatus.PENDING,
    );
    const consultaOriginalPorEscalado = new Map<string, string>();
    for (const e of pendientes) {
      const mensaje = await this.prisma.message.findFirst({
        where: {
          conversationId: e.conversationId,
          role: 'USER',
          createdAt: { lte: e.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      if (mensaje) consultaOriginalPorEscalado.set(e.id, mensaje.content);
    }

    const paraMaterial: EscaladoParaMaterial[] = escalados.map((e) => ({
      id: e.id,
      status: e.status as 'RESOLVED' | 'PENDING',
      resolution: e.resolution,
      yaCapitalizado:
        e.resolvedWithDocumentId != null ||
        capitalizadosPorDocumento.has(e.id) ||
        capitalizadosPorEntrevista.has(e.id),
      consultaOriginal: consultaOriginalPorEscalado.get(e.id) ?? null,
    }));

    return materialDeEscalados(paraMaterial);
  }

  /**
   * Tercera fuente: los señalamientos del detector.
   *
   * ⚠️ **Vigentes por documento, no los de la última corrida.** Con el
   * análisis incremental (FR-013a) una corrida puede saltear 20 documentos y
   * analizar 2: leer los findings de esa corrida devolvería 2 y vaciaría la
   * pantalla. Vigente = el `documentVersion` coincide con la versión actual
   * del documento.
   */
  private async fuenteDocumentos(
    sectorId: string,
    agentType: AgentType,
    empleadoId: string,
  ): Promise<ItemParaMejorar[]> {
    const findings = await this.documentReview.senalamientosVigentes(
      sectorId,
      agentType,
    );
    if (findings.length === 0) return [];

    // FR-024/SC-009: un señalamiento sobre un documento transversal se muestra
    // SOLO a quien es responsable de todas las áreas. Se analiza una vez y
    // alcanza a las cinco, pero mostrárselo a quien no puede corregirlo sería
    // un ítem sin acción detrás.
    const hayTransversal = findings.some((f) => f.document.agentType === null);
    const puedeTransversales = hayTransversal
      ? await this.knowledge.esResponsableDeAgente(empleadoId, null)
      : false;

    return findings
      .filter((f) => f.document.agentType !== null || puedeTransversales)
      .map(
        (f): ItemParaMejorar => ({
          id: `${PREFIJO.DOCUMENTO_INCONCLUSO}:${f.documentId}`,
          source: ImprovementSource.DOCUMENTO_INCONCLUSO,
          title: f.document.title,
          evidence: f.reason,
          document: {
            id: f.documentId,
            title: f.document.title,
            version: f.documentVersion,
            esTransversal: f.document.agentType === null,
          },
          unansweredQuestions: f.unansweredQuestions,
          severity: f.severity,
          canInterview: true,
          canDismiss: true,
        }),
      );
  }

  // ==========================================================================
  // Filtrado y corte
  // ==========================================================================

  private async filtrarYCortar(
    crudos: ItemParaMejorar[],
    sectorId: string,
    agentType: AgentType,
  ): Promise<ItemParaMejorar[]> {
    const overlapCut = this.config.get<number>('COVERAGE_THEME_OVERLAP')!;
    const maxItems = this.config.get<number>('IMPROVEMENT_MAX_ITEMS')!;

    const [descartes, marcasViejas, previas] = await Promise.all([
      this.descartesVigentes(sectorId),
      this.marcasViejas(),
      this.preguntasPrevias(agentType),
    ]);

    return armarLista(crudos, {
      descartes,
      marcasViejas,
      previas,
      overlapCut,
      maxItems,
    });
  }

  private async descartesVigentes(
    sectorId: string,
  ): Promise<DescarteVigente[]> {
    const filas = await this.prisma.improvementDismissal.findMany({
      where: { sectorId },
      select: {
        source: true,
        themeQueryEventIds: true,
        escalationId: true,
        documentId: true,
        documentVersion: true,
        dismissedAt: true,
      },
    });
    return filas;
  }

  /**
   * FR-024b/D6: las marcas de "atendido" de la pantalla anterior siguen
   * valiendo como descarte. No hay migración de datos: se leen las dos tablas.
   * Nadie debería volver a descartar lo que ya descartó.
   */
  private async marcasViejas() {
    const marcas = await this.prisma.coverageThemeMark.findMany({
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

  /** FR-023: lo ya entrevistado, leído de `InterviewQuestion` por Prisma. */
  private async preguntasPrevias(
    agentType: AgentType,
  ): Promise<PreguntaPrevia[]> {
    const previas = await this.prisma.interviewQuestion.findMany({
      where: {
        session: {
          sector: { agentType },
          status: { not: 'FALLIDA' },
        },
      },
      select: {
        themeQueryEventIds: true,
        escalationId: true,
        documentId: true,
        documentVersion: true,
      },
    });
    return previas;
  }

  // ==========================================================================
  // La entrada de la entrevista
  // ==========================================================================

  /**
   * De dónde salen las preguntas de una sesión (FR-005/FR-008).
   *
   * Con `itemId`, ese ítem va **primero** y el resto de la lista detrás: la
   * entrevista es sobre el ítem elegido, sin pasar por una pantalla
   * intermedia. Sin `itemId`, es la lista tal cual.
   *
   * Es lo que hace que la lista que se ve y las preguntas que se reciben
   * salgan del mismo lugar; si divergieran, alguien aprieta un ítem y le
   * preguntan por otro.
   */
  async materialParaEntrevista(
    sectorId: string,
    agentType: AgentType,
    empleadoId: string,
    itemId?: string,
  ): Promise<{ material: MaterialDePregunta[]; huboItems: boolean }> {
    const crudos = await this.itemsCrudos(sectorId, agentType, empleadoId);
    const items = await this.filtrarYCortar(crudos, sectorId, agentType);

    const ordenados = itemId
      ? [
          ...items.filter((i) => i.id === itemId),
          ...items.filter((i) => i.id !== itemId),
        ]
      : items;

    const material = ordenados
      .map((i) => this.aMaterial(i))
      .filter((m): m is MaterialDePregunta => m !== null);

    return { material, huboItems: crudos.length > 0 };
  }

  /**
   * Un ítem de la lista, en la forma que la entrevista sabe preguntar.
   *
   * `null` cuando el ítem ya no se puede entrevistar — por ejemplo, un
   * documento que se borró o desactivó entre la revisión y el momento de
   * abrirla. Se saltea en vez de abrir una entrevista sobre algo que ya no
   * existe; si era el único, quien lo pidió recibe el 422 con su motivo.
   */
  private aMaterial(item: ItemParaMejorar): MaterialDePregunta | null {
    if (item.source === 'DOCUMENTO_INCONCLUSO') {
      const doc = item.document;
      if (!doc) return null;
      return {
        origin: 'DOCUMENTO_INCONCLUSO',
        document: {
          id: doc.id,
          title: doc.title,
          version: doc.version,
          isActive: true,
        },
        unansweredQuestions: item.unansweredQuestions ?? [],
        reason: item.evidence,
        severity: item.severity ?? 0,
      };
    }
    return item.materialOriginal ?? null;
  }
}
