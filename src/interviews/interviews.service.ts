import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AgentType,
  EscalationStatus,
  InterviewQuestionOrigin,
  InterviewQuestionStatus,
  InterviewStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { KnowledgeCoverageService } from '../ai/knowledge/knowledge-coverage.service';
import { InterviewsDraftingService } from './interviews-drafting.service';
import {
  elegirForma,
  excluirPorCausa,
  yaPreguntado,
  MaterialDePregunta,
  PreguntaPrevia,
} from './interviews-questions';
import {
  materialDeEscalados,
  EscaladoParaMaterial,
} from './interviews-fallback';
import { esAsentimientoVacio } from './interviews-thin-answer';

type MotivoSinMaterial =
  | 'SIN_CORRIDA'
  | 'SIN_MUESTRA_SUFICIENTE'
  | 'TODO_CUBIERTO'
  | 'YA_ENTREVISTADO';

const ESTADOS_SIN_CERRAR: InterviewStatus[] = [
  InterviewStatus.PREPARANDO,
  InterviewStatus.EN_CURSO,
  InterviewStatus.CERRANDO,
  InterviewStatus.EN_REVISION,
];

/**
 * La entrevista de capacitación por chat (spec 010, RF11): las preguntas
 * salen de lo que el agente realmente no pudo contestar (spec 009), no de
 * un cuestionario a ciegas.
 *
 * Dos jobs enmarcan un bucle sincrónico (D4): `open()` resuelve el material
 * (solo Prisma, sin LLM) y encola; `runOpen()` —llamado por
 * `InterviewOpenProcessor` fuera del request— redacta las preguntas con una
 * sola llamada y las deja congeladas. `answer()`/`skip()` no llaman al
 * modelo: las preguntas ya están escritas.
 */
@Injectable()
export class InterviewsService {
  private readonly logger = new Logger(InterviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue('interview-open') private readonly openQueue: Queue,
    @InjectQueue('interview-close') private readonly closeQueue: Queue,
    private readonly knowledge: KnowledgeService,
    private readonly coverage: KnowledgeCoverageService,
    private readonly drafting: InterviewsDraftingService,
  ) {}

  // ==========================================================================
  // Abrir
  // ==========================================================================

  async open(sectorId: string, empleadoId: string) {
    const sector = await this.prisma.sector.findUnique({
      where: { id: sectorId },
    });
    if (!sector) throw new NotFoundException('Área no encontrada');
    if (!sector.agentType) {
      throw new BadRequestException(
        'Esta área no tiene agente asociado; no se puede entrevistar',
      );
    }

    // FR-002: rechazar antes de tocar nada.
    const permitido = await this.knowledge.esResponsableDeAgente(
      empleadoId,
      sector.agentType,
    );
    if (!permitido) {
      throw new ForbiddenException('No sos responsable de esta área');
    }

    // FR-003: una sola sesión sin cerrar por persona y área.
    const abierta = await this.prisma.interviewSession.findFirst({
      where: {
        openedById: empleadoId,
        sectorId,
        status: { in: ESTADOS_SIN_CERRAR },
      },
    });
    if (abierta) {
      throw new ConflictException({
        statusCode: 409,
        reason: 'SESSION_ALREADY_OPEN',
        session: { id: abierta.id, status: abierta.status },
        message: 'Ya tenés una entrevista sin cerrar para esta área.',
      });
    }

    // FR-016: el 422 se decide EN EL REQUEST — no hace falta un job para
    // saber que no hay con qué. Solo lecturas de Prisma, sin LLM.
    const resuelto = await this.resolverMaterial(
      sectorId,
      sector.agentType,
      empleadoId,
    );
    if (resuelto.material.length === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        reason: resuelto.motivo,
        message: this.mensajeSinMaterial(resuelto.motivo!),
      });
    }

    const session = await this.prisma.interviewSession.create({
      data: {
        status: InterviewStatus.PREPARANDO,
        sectorId,
        agentType: sector.agentType,
        openedById: empleadoId,
        coverageScanId: resuelto.coverageScanId,
      },
    });

    // FR-004: el material se resolvió ACÁ, en el momento de abrir, y viaja
    // con el job — el worker no lo vuelve a derivar más tarde.
    await this.openQueue.add('open', {
      sessionId: session.id,
      material: resuelto.material,
    });

    return {
      id: session.id,
      status: session.status,
      sectorId,
      agentType: sector.agentType,
    };
  }

  private mensajeSinMaterial(motivo: MotivoSinMaterial): string {
    switch (motivo) {
      case 'SIN_CORRIDA':
        return 'Todavía no se corrió el resumen de cobertura para esta área.';
      case 'SIN_MUESTRA_SUFICIENTE':
        return 'Todavía no hay tráfico suficiente como para saber qué falta.';
      case 'TODO_CUBIERTO':
        return 'No se detectaron huecos ni casos pendientes para esta área.';
      case 'YA_ENTREVISTADO':
        return (
          'Ya se entrevistó todo lo que el resumen encontró para esta área. ' +
          'Volvé a correr el resumen cuando haya consultas nuevas: los temas ' +
          'que ya se preguntaron no se repiten.'
        );
    }
  }

  /**
   * FR-007..FR-016. Primero los temas de cobertura del área; si no hay
   * ninguno (excluidos por causa o ya preguntados), el respaldo (FR-013/015).
   */
  private async resolverMaterial(
    sectorId: string,
    agentType: AgentType,
    empleadoId: string,
  ): Promise<{
    material: MaterialDePregunta[];
    coverageScanId: string | null;
    fromCoverage: boolean;
    motivo: MotivoSinMaterial | null;
  }> {
    const overlapCut = this.config.get<number>('COVERAGE_THEME_OVERLAP')!;
    const maxQuotes = this.config.get<number>(
      'INTERVIEW_MAX_QUOTES_PER_QUESTION',
    )!;
    const maxQuestions = this.config.get<number>('INTERVIEW_MAX_QUESTIONS')!;

    // FR-006b/c: qué ya se preguntó en sesiones no FALLIDA de esta área.
    const previas = await this.prisma.interviewQuestion.findMany({
      where: {
        session: { sectorId, status: { not: InterviewStatus.FALLIDA } },
      },
      select: { themeQueryEventIds: true, escalationId: true },
    });
    const previos: PreguntaPrevia[] = previas.map((p) => ({
      themeQueryEventIds: p.themeQueryEventIds,
      escalationId: p.escalationId,
    }));

    const latest = await this.coverage.getLatest(empleadoId);

    let coverageScanId: string | null = null;
    let sinCorridaOInsuficiente: MotivoSinMaterial | null = null;
    let temaMaterial: MaterialDePregunta[] = [];
    // ¿Había material para esta área, pero todo ya se preguntó antes
    // (FR-006b)? No es lo mismo que "no hay huecos": decirle `TODO_CUBIERTO`
    // a quien viene de apretar "Entrevistar sobre esto" sobre un tema que
    // está viendo en pantalla es mentirle. Encontrado clickeando el salto
    // entre pantallas, que por API no se veía.
    let todoYaPreguntado = false;

    if (
      latest.notice?.code === 'SIN_CORRIDA' ||
      latest.notice?.code === 'SIN_MUESTRA_SUFICIENTE'
    ) {
      sinCorridaOInsuficiente = latest.notice.code;
    } else if (latest.scan) {
      coverageScanId = latest.scan.id;
      temaMaterial = latest.themes
        .filter((t) => t.agentType === agentType)
        .map(
          (t): MaterialDePregunta => ({
            origin: 'TEMA_COBERTURA',
            themeId: t.id,
            label: t.label,
            agentType: t.agentType,
            band: t.band,
            cause: t.cause,
            queryEventIds: t.queryEventIds,
            quotes: t.quotes.slice(0, maxQuotes),
            queryCount: t.queryCount,
            documents: t.documents
              .filter((d) => d.isActive)
              .map((d) => ({
                id: d.id,
                title: d.title,
                version: d.version,
                isActive: d.isActive,
              })),
          }),
        )
        .filter((m) => !excluirPorCausa(m));

      const antesDeFiltrarPreguntados = temaMaterial.length;
      temaMaterial = temaMaterial.filter(
        (m) => !yaPreguntado(m, previos, overlapCut),
      );
      todoYaPreguntado =
        antesDeFiltrarPreguntados > 0 && temaMaterial.length === 0;
    }

    if (temaMaterial.length > 0) {
      const ordenado = [...temaMaterial]
        .sort((a, b) => {
          const qa = a.origin === 'TEMA_COBERTURA' ? a.queryCount : 0;
          const qb = b.origin === 'TEMA_COBERTURA' ? b.queryCount : 0;
          return qb - qa;
        })
        .slice(0, maxQuestions);
      return {
        material: ordenado,
        coverageScanId,
        fromCoverage: true,
        motivo: null,
      };
    }

    // FR-013/015: sin temas de cobertura para el área, probar el respaldo.
    const respaldo = await this.resolverMaterialDeRespaldo(
      agentType,
      previos,
      overlapCut,
    );
    if (respaldo.length > 0) {
      return {
        material: respaldo.slice(0, maxQuestions),
        coverageScanId: null,
        fromCoverage: false,
        motivo: null,
      };
    }

    return {
      material: [],
      coverageScanId: null,
      fromCoverage: false,
      motivo:
        sinCorridaOInsuficiente ??
        (todoYaPreguntado ? 'YA_ENTREVISTADO' : 'TODO_CUBIERTO'),
    };
  }

  /**
   * FR-013c/e: el área se asocia por `currentAgent` de la conversación —
   * `Escalation` no guarda agentType propio.
   */
  private async resolverMaterialDeRespaldo(
    agentType: AgentType,
    previos: PreguntaPrevia[],
    overlapCut: number,
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

    // FR-013e señal 2: documento creado enseñando al agente (spec 005) o al
    // guardar sin enviar (spec 007) — ninguno de los dos toca resolvedWithDocumentId.
    const documentosCapitalizados =
      await this.prisma.knowledgeDocument.findMany({
        where: { sourceType: 'ESCALADO', sourceId: { in: ids } },
        select: { sourceId: true },
      });
    const capitalizadosPorDocumento = new Set(
      documentosCapitalizados.map((d) => d.sourceId!),
    );

    // FR-013e señal 3: ya cerrado por esta misma feature.
    const candidatosAprobados = await this.prisma.interviewCandidate.findMany({
      where: {
        status: 'APROBADO',
        question: { escalationId: { in: ids } },
      },
      select: { question: { select: { escalationId: true } } },
    });
    const capitalizadosPorEntrevista = new Set(
      candidatosAprobados.map((c) => c.question.escalationId!),
    );

    // La consulta original de los PENDING: el último mensaje del usuario
    // antes de la escalación (Escalation.reason es diagnóstico del sistema,
    // no la consulta — ver research.md).
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

    const material = materialDeEscalados(paraMaterial);
    return material.filter((m) => !yaPreguntado(m, previos, overlapCut));
  }

  /**
   * Llamado por `InterviewOpenProcessor` (Principio IV). Termina en
   * `EN_CURSO` o `FALLIDA`, nunca a medias (T024/FR-005).
   */
  async runOpen(
    sessionId: string,
    material: MaterialDePregunta[],
  ): Promise<void> {
    try {
      const items = material.map((m, i) => ({
        id: `q${i}`,
        kind: elegirForma(m),
        material: m,
      }));

      const textos = await this.drafting.redactarPreguntas(items);
      if (!textos) {
        await this.marcarFallida(
          sessionId,
          'No se pudieron redactar las preguntas de esta sesión.',
        );
        return;
      }

      await this.prisma.$transaction(
        items.map((it, idx) =>
          this.prisma.interviewQuestion.create({
            data: {
              sessionId,
              order: idx + 1,
              origin: it.material.origin as InterviewQuestionOrigin,
              kind: it.kind,
              text: textos.get(it.id)!,
              themeLabel:
                it.material.origin === 'TEMA_COBERTURA'
                  ? it.material.label
                  : null,
              themeQueryEventIds:
                it.material.origin === 'TEMA_COBERTURA'
                  ? it.material.queryEventIds
                  : [],
              quotes:
                it.material.origin === 'TEMA_COBERTURA' ||
                it.material.origin === 'ESCALADO_PENDIENTE'
                  ? it.material.quotes
                  : [],
              resolutionText:
                it.material.origin === 'ESCALADO_SIN_CAPITALIZAR'
                  ? it.material.resolutionText
                  : null,
              documentId:
                it.material.origin === 'TEMA_COBERTURA' &&
                it.material.documents[0]
                  ? it.material.documents[0].id
                  : null,
              documentVersion:
                it.material.origin === 'TEMA_COBERTURA' &&
                it.material.documents[0]
                  ? it.material.documents[0].version
                  : null,
              escalationId:
                it.material.origin !== 'TEMA_COBERTURA'
                  ? it.material.escalationId
                  : null,
            },
          }),
        ),
      );

      await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: { status: InterviewStatus.EN_CURSO },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Apertura de ${sessionId} falló: ${message}`);
      await this.marcarFallida(sessionId, message);
    }
  }

  private async marcarFallida(
    sessionId: string,
    motivo: string,
  ): Promise<void> {
    await this.prisma.interviewSession
      .update({
        where: { id: sessionId },
        data: { status: InterviewStatus.FALLIDA, failureReason: motivo },
      })
      .catch(() => {
        // No perder el error original si esto también falla.
      });
  }

  // ==========================================================================
  // Responder / saltear
  // ==========================================================================

  async answer(
    sessionId: string,
    questionId: string,
    text: string,
    empleadoId: string,
  ) {
    const session = await this.cargarSesionPropia(sessionId, empleadoId);
    if (session.status !== InterviewStatus.EN_CURSO) {
      throw new ConflictException(
        'La sesión no admite respuestas en este estado.',
      );
    }

    const actual = await this.preguntaActual(sessionId);
    if (!actual || actual.id !== questionId) {
      throw new ConflictException(
        'Esta no es la pregunta actual de la sesión.',
      );
    }

    const previas = await this.prisma.interviewAnswer.findMany({
      where: { questionId },
    });
    const yaRepregunto = previas.some((a) => a.flaggedThin);
    const esVacia = esAsentimientoVacio(text);
    const ofrecerRetry = esVacia && !yaRepregunto;

    await this.prisma.interviewAnswer.create({
      data: {
        questionId,
        text,
        attempt: previas.length + 1,
        flaggedThin: ofrecerRetry,
      },
    });

    if (!ofrecerRetry) {
      await this.prisma.interviewQuestion.update({
        where: { id: questionId },
        data: {
          status: esVacia
            ? InterviewQuestionStatus.SIN_RESPONDER
            : InterviewQuestionStatus.RESPONDIDA,
        },
      });
    }

    await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });

    const siguiente = ofrecerRetry
      ? actual
      : await this.preguntaActual(sessionId);

    // FR-023a: primera de las dos vías a CERRANDO — sola, al contestarse la
    // última pregunta.
    let status: InterviewStatus = InterviewStatus.EN_CURSO;
    if (!ofrecerRetry && !siguiente) {
      status = await this.transicionarACerrando(sessionId);
    }

    return {
      accepted: true,
      retry: ofrecerRetry,
      retryHint: ofrecerRetry
        ? 'Contame un poco más — ¿qué le dirías en concreto a alguien que pregunta esto?'
        : null,
      progress: await this.progreso(sessionId),
      next: siguiente ? await this.currentEnvelope(siguiente) : null,
      status,
    };
  }

  async skip(sessionId: string, questionId: string, empleadoId: string) {
    const session = await this.cargarSesionPropia(sessionId, empleadoId);
    if (session.status !== InterviewStatus.EN_CURSO) {
      throw new ConflictException(
        'La sesión no admite respuestas en este estado.',
      );
    }

    const actual = await this.preguntaActual(sessionId);
    if (!actual || actual.id !== questionId) {
      throw new ConflictException(
        'Esta no es la pregunta actual de la sesión.',
      );
    }

    await this.prisma.interviewQuestion.update({
      where: { id: questionId },
      data: { status: InterviewQuestionStatus.SALTEADA },
    });
    await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });

    const siguiente = await this.preguntaActual(sessionId);

    let status: InterviewStatus = InterviewStatus.EN_CURSO;
    if (!siguiente) {
      status = await this.transicionarACerrando(sessionId);
    }

    return {
      accepted: true,
      retry: false,
      retryHint: null,
      progress: await this.progreso(sessionId),
      next: siguiente ? await this.currentEnvelope(siguiente) : null,
      status,
    };
  }

  // ==========================================================================
  // Terminar
  // ==========================================================================

  /**
   * FR-023a segunda vía: cierre explícito, disponible aunque queden
   * preguntas pendientes. FR-023b: con pendientes, exige confirmación
   * diciendo cuántas — en revisión ya no se contesta nada.
   */
  async finish(sessionId: string, confirmPending: boolean, empleadoId: string) {
    let session = await this.cargarSesionPropia(sessionId, empleadoId);
    session = await this.marcarAbandonadaSiCorresponde(session);
    // FR-022: una sesión ABANDONADA también se puede cerrar — es la vía
    // para que sus respuestas útiles lleguen a revisión. No se cierra sola.
    if (
      session.status !== InterviewStatus.EN_CURSO &&
      session.status !== InterviewStatus.ABANDONADA
    ) {
      throw new ConflictException('La sesión no está en curso.');
    }

    const pendientes = await this.prisma.interviewQuestion.count({
      where: { sessionId, status: InterviewQuestionStatus.PENDIENTE },
    });

    if (pendientes > 0 && !confirmPending) {
      throw new BadRequestException({
        statusCode: 400,
        reason: 'PENDING_QUESTIONS',
        pending: pendientes,
        message: `Quedan ${pendientes} preguntas sin responder. Confirmá si querés cerrar igual.`,
      });
    }

    const status = await this.transicionarACerrando(sessionId);
    return { id: sessionId, status, pendingSkipped: pendientes };
  }

  private async transicionarACerrando(
    sessionId: string,
  ): Promise<InterviewStatus> {
    await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { status: InterviewStatus.CERRANDO },
    });
    await this.closeQueue.add('close', { sessionId });
    return InterviewStatus.CERRANDO;
  }

  // ==========================================================================
  // Leer
  // ==========================================================================

  async get(sessionId: string, empleadoId: string) {
    let session = await this.cargarSesionPropia(sessionId, empleadoId);
    session = await this.marcarAbandonadaSiCorresponde(session);

    const current =
      session.status === InterviewStatus.EN_CURSO
        ? await this.preguntaActual(sessionId)
        : null;

    return {
      id: session.id,
      status: session.status,
      sector: { id: session.sectorId },
      agentType: session.agentType,
      progress: await this.progreso(sessionId),
      fromCoverage: session.coverageScanId != null,
      current: current ? await this.currentEnvelope(current) : null,
      failureReason: session.failureReason,
    };
  }

  /**
   * FR-022, resuelto AL CONSULTAR (T065) — no hace falta un barrido
   * programado para un estado que solo importa cuando alguien mira. Sin
   * actividad por `INTERVIEW_ABANDON_DAYS`, una sesión `EN_CURSO` pasa a
   * `ABANDONADA`: deja de admitir respuestas (`answer`/`skip` ya rechazan
   * cualquier estado que no sea `EN_CURSO`), pero **no** se cierra sola —
   * "no se publica nada solo" incluye no producir candidatos sin que
   * alguien lo pida. `finish()` sigue disponible sobre una sesión
   * `ABANDONADA` para quien la encuentre y quiera procesar lo que se
   * alcanzó a responder.
   */
  private async marcarAbandonadaSiCorresponde(
    session: Awaited<ReturnType<InterviewsService['cargarSesionPropia']>>,
  ): Promise<Awaited<ReturnType<InterviewsService['cargarSesionPropia']>>> {
    if (session.status !== InterviewStatus.EN_CURSO) return session;

    const diasInactivo = this.config.get<number>('INTERVIEW_ABANDON_DAYS')!;
    const limite = new Date(Date.now() - diasInactivo * 24 * 60 * 60 * 1000);
    if (session.lastActivityAt >= limite) return session;

    return this.prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: InterviewStatus.ABANDONADA },
    });
  }

  private async cargarSesionPropia(sessionId: string, empleadoId: string) {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.openedById !== empleadoId) {
      throw new ForbiddenException('Esta sesión no es tuya');
    }
    return session;
  }

  private async preguntaActual(sessionId: string) {
    return this.prisma.interviewQuestion.findFirst({
      where: { sessionId, status: InterviewQuestionStatus.PENDIENTE },
      orderBy: { order: 'asc' },
    });
  }

  private async progreso(sessionId: string) {
    const [total, pendientes] = await Promise.all([
      this.prisma.interviewQuestion.count({ where: { sessionId } }),
      this.prisma.interviewQuestion.count({
        where: { sessionId, status: InterviewQuestionStatus.PENDIENTE },
      }),
    ]);
    return { answered: total - pendientes, total };
  }

  private async currentEnvelope(pregunta: {
    id: string;
    order: number;
    kind: string;
    origin: string;
    text: string;
    quotes: string[];
    resolutionText: string | null;
    documentId: string | null;
  }) {
    const document = pregunta.documentId
      ? await this.prisma.knowledgeDocument.findUnique({
          where: { id: pregunta.documentId },
          select: { id: true, title: true, version: true, content: true },
        })
      : null;

    const retried = await this.prisma.interviewAnswer.findFirst({
      where: { questionId: pregunta.id, flaggedThin: true },
    });

    return {
      id: pregunta.id,
      order: pregunta.order,
      kind: pregunta.kind,
      origin: pregunta.origin,
      text: pregunta.text,
      quotes: pregunta.quotes,
      document,
      resolutionText: pregunta.resolutionText,
      retried: retried != null,
    };
  }
}
