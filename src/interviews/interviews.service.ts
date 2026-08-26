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
  InterviewQuestionOrigin,
  InterviewQuestionStatus,
  InterviewStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { KnowledgeCoverageService } from '../ai/knowledge/knowledge-coverage.service';
import { ImprovementsService } from '../improvements/improvements.service';
import { InterviewsDraftingService } from './interviews-drafting.service';
import {
  elegirForma,
  MaterialDePregunta,
  MaterialDocumento,
} from './interviews-questions';
import { esAsentimientoVacio } from './interviews-thin-answer';
import { esOpcionSinEditar } from './interviews-chosen-option';

/**
 * Por qué una sesión no tiene con qué preguntar.
 *
 * Spec 011: `SIN_CORRIDA` y `SIN_MUESTRA_SUFICIENTE` **dejaron de ser
 * motivos**. Las otras dos fuentes de la lista —escalados históricos y
 * documentos que el detector marcó incompletos— no dependen del barrido de
 * cobertura, así que quedarse sin preguntas ya no puede achacársele a él.
 *
 * Los dos que sobreviven siguen sin ser intercambiables: "no hay huecos" y "ya
 * se preguntó todo lo que había" piden acciones distintas, y la distinción se
 * encontró clickeando el salto entre pantallas, no por API.
 */
type MotivoSinMaterial = 'TODO_CUBIERTO' | 'YA_ENTREVISTADO';

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
    private readonly improvements: ImprovementsService,
  ) {}

  // ==========================================================================
  // Abrir
  // ==========================================================================

  async open(sectorId: string, empleadoId: string, itemId?: string) {
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
      itemId,
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
        // Spec 011: la sesión ya no cuelga de una corrida de cobertura. El
        // material viene de tres fuentes y solo una de ellas es un barrido;
        // atarla a un `scanId` diría que la entrevista salió de ahí cuando
        // puede haber salido de un escalado de hace meses o del detector.
        coverageScanId: null,
      },
    });

    // ⚠️ El `findFirst` de arriba deja una ventana: dos aperturas casi
    // simultáneas la pasan las dos y quedan DOS sesiones abiertas del mismo
    // área, que es justo lo que FR-003 prohíbe. Pasó de verdad — dos sesiones
    // con 6 MILISEGUNDOS de diferencia, al automatizar el panel.
    //
    // Prisma no modela índices únicos parciales, así que la regla no puede
    // vivir en la base sin sacar SQL fuera del esquema (y el proyecto usa
    // `db push`). Se reconcilia después de crear: gana **la más vieja**, con
    // desempate por id. Como el criterio es determinista, las dos llamadas
    // llegan a la MISMA conclusión sin hablarse — una se borra y la otra
    // sigue. Es seguro porque una sesión recién creada todavía no tiene
    // preguntas: el job se encola más abajo.
    const perdedora = await this.reconciliarSesionDuplicada(
      session,
      empleadoId,
      sectorId,
    );
    if (perdedora) {
      throw new ConflictException({
        statusCode: 409,
        reason: 'SESSION_ALREADY_OPEN',
        session: { id: perdedora.id, status: perdedora.status },
        message: 'Ya tenés una entrevista sin cerrar para esta área.',
      });
    }

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

  /**
   * Cierra la ventana entre el `findFirst` y el `create` de `open()`.
   *
   * Si quedaron varias sesiones sin cerrar de la misma persona y área, gana
   * **la más vieja** (desempate por id, que es estable). Determinista a
   * propósito: las dos llamadas concurrentes calculan lo mismo sin
   * coordinarse.
   *
   * @returns la sesión ganadora **si la nuestra perdió** (y entonces la
   *   nuestra ya se borró); `null` si la nuestra ganó y se puede seguir.
   */
  private async reconciliarSesionDuplicada(
    propia: { id: string; createdAt: Date },
    empleadoId: string,
    sectorId: string,
  ): Promise<{ id: string; status: InterviewStatus } | null> {
    const abiertas = await this.prisma.interviewSession.findMany({
      where: {
        openedById: empleadoId,
        sectorId,
        status: { in: ESTADOS_SIN_CERRAR },
      },
      select: { id: true, status: true, createdAt: true },
    });
    if (abiertas.length <= 1) return null;

    const ganadora = abiertas.reduce((mejor, actual) => {
      if (actual.createdAt.getTime() !== mejor.createdAt.getTime()) {
        return actual.createdAt < mejor.createdAt ? actual : mejor;
      }
      return actual.id < mejor.id ? actual : mejor;
    });
    if (ganadora.id === propia.id) return null;

    this.logger.warn(
      `Dos aperturas simultáneas de ${sectorId}: se descarta ${propia.id} y ` +
        `se retoma ${ganadora.id}`,
    );
    await this.prisma.interviewSession
      .delete({ where: { id: propia.id } })
      .catch(() => {
        // Si otra llamada ya la borró, no hay nada que arreglar.
      });
    return { id: ganadora.id, status: ganadora.status };
  }

  private mensajeSinMaterial(motivo: MotivoSinMaterial): string {
    switch (motivo) {
      case 'TODO_CUBIERTO':
        return (
          'No hay nada que mejorar en esta área: ni consultas sin responder, ' +
          'ni casos pendientes, ni documentos incompletos.'
        );
      case 'YA_ENTREVISTADO':
        return (
          'Ya se entrevistó todo lo que hay para esta área. Actualizá desde ' +
          'la pantalla de mejoras cuando haya novedades: lo que ya se ' +
          'preguntó no se repite.'
        );
    }
  }

  /**
   * De dónde salen las preguntas (spec 011, FR-008/FR-029).
   *
   * **Ya no las resuelve esta clase.** La lista unificada —consultas que
   * fallaron, escalados históricos y documentos que el detector marcó
   * incompletos— la arma `ImprovementsService`, y la entrevista la consume. Es
   * lo que hace que la lista que se ve en pantalla y las preguntas que se
   * reciben salgan del mismo lugar: si divergieran, alguien aprieta un ítem y
   * le preguntan por otro.
   *
   * Las tres fuentes son de primera (FR-008): se retiró el respaldo que hacía
   * entrar a los escalados solo cuando no había temas de cobertura.
   *
   * `itemId` opcional: con él, ese ítem va primero — la entrevista es sobre lo
   * que se eligió, sin pasar por una pantalla intermedia (FR-005).
   */
  private async resolverMaterial(
    sectorId: string,
    agentType: AgentType,
    empleadoId: string,
    itemId?: string,
  ): Promise<{
    material: MaterialDePregunta[];
    motivo: MotivoSinMaterial | null;
  }> {
    const maxQuestions = this.config.get<number>('INTERVIEW_MAX_QUESTIONS')!;

    const { material, huboItems } =
      await this.improvements.materialParaEntrevista(
        sectorId,
        agentType,
        empleadoId,
        itemId,
      );

    if (material.length > 0) {
      return { material: material.slice(0, maxQuestions), motivo: null };
    }

    // Los dos no son intercambiables: decirle "no hay nada" a quien viene de
    // apretar un ítem que está viendo en pantalla es mentirle.
    return {
      material: [],
      motivo: huboItems ? 'YA_ENTREVISTADO' : 'TODO_CUBIERTO',
    };
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
              text: textos.get(it.id)!.texto,
              // Spec 012 (FR-012): congeladas junto al texto. Una sesión que
              // se pausa y se retoma muestra estas mismas, sin regenerarlas.
              options: textos.get(it.id)!.opciones,
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
              // El documento a corregir sale de dos orígenes: un tema de
              // cobertura que trae documentos, o un señalamiento del detector
              // (spec 011), que trae exactamente uno. Guardar la VERSIÓN es lo
              // que después permite decidir que ya se entrevistó sobre él
              // (FR-023) sin bloquearlo para siempre si alguien lo edita.
              documentId: documentoDelMaterial(it.material)?.id ?? null,
              documentVersion:
                documentoDelMaterial(it.material)?.version ?? null,
              escalationId:
                it.material.origin === 'ESCALADO_SIN_CAPITALIZAR' ||
                it.material.origin === 'ESCALADO_PENDIENTE'
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
    // Spec 012 (FR-009): una opción propuesta y enviada TAL CUAL nunca
    // dispara repregunta, aunque sea corta — el sistema no puede proponer un
    // texto y después objetar que lo elijan. Envuelve a `esAsentimientoVacio`
    // sin modificarla: una opción editada vuelve a la validación de siempre.
    const eligioUnaOpcion = esOpcionSinEditar(text, actual.options);
    const esVacia = !eligioUnaOpcion && esAsentimientoVacio(text);
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
      history: await this.historial(sessionId),
      current: current ? await this.currentEnvelope(current) : null,
      failureReason: session.failureReason,
    };
  }

  /**
   * El historial de la conversación (spec 012, FR-001/002/003). Se arma
   * leyendo lo que la spec 010 ya persiste: no hay nada nuevo que guardar
   * para poder mostrarlo.
   *
   * Sale de la base y no de lo que el navegador acumuló, que es lo que hace
   * que una sesión pausada y retomada muestre todo lo contestado antes de la
   * pausa (FR-002).
   *
   * **Excluye la pregunta actual**, que viaja en `current`: concatenar
   * `history + current` da la conversación completa sin duplicados. Filtrar
   * por `status != PENDIENTE` alcanza — la actual es siempre la primera
   * pendiente (`preguntaActual`).
   */
  private async historial(sessionId: string) {
    const preguntas = await this.prisma.interviewQuestion.findMany({
      where: { sessionId, status: { not: InterviewQuestionStatus.PENDIENTE } },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        order: true,
        text: true,
        status: true,
        // El intento final, no todos: la repregunta es una corrección dentro
        // de la misma pregunta, no una pregunta nueva.
        answers: {
          orderBy: { attempt: 'desc' },
          take: 1,
          select: { text: true },
        },
      },
    });

    return preguntas.map((p) => ({
      id: p.id,
      order: p.order,
      text: p.text,
      status: p.status,
      // SALTEADA y SIN_RESPONDER no son lo mismo y no se aplastan (FR-003):
      // en una no hay nada que el responsable haya puesto, en la otra sí —
      // contestó, se repreguntó, y tampoco alcanzó, pero el texto es suyo.
      answer: p.answers[0]?.text ?? null,
    }));
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
    options: string[];
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
      // Spec 012 (FR-004/005/006). Siempre presente: `[]` significa
      // "contestá con tus palabras", no que haya fallado algo — un campo
      // ausente obligaría al panel a inventar una rama.
      options: pregunta.options ?? [],
      document,
      resolutionText: pregunta.resolutionText,
      retried: retried != null,
    };
  }
}

/**
 * El documento que una pregunta va a corregir, si lo hay. Sale de dos
 * orígenes distintos y conviene resolverlo en un solo lugar: un tema de
 * cobertura puede traer varios (gana el primero, el de más peso) y un
 * señalamiento del detector trae exactamente uno.
 */
function documentoDelMaterial(
  material: MaterialDePregunta,
): MaterialDocumento | null {
  if (material.origin === 'TEMA_COBERTURA')
    return material.documents[0] ?? null;
  if (material.origin === 'DOCUMENTO_INCONCLUSO') return material.document;
  return null;
}
