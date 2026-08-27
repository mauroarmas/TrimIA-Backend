import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Audience,
  CandidateApplyMode,
  InterviewCandidateStatus,
  InterviewStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { componerContenido } from '../ai/knowledge/apply-mode';
import { InterviewsDraftingService } from './interviews-drafting.service';

type ApproveResult =
  | {
      candidateId: string;
      ok: true;
      documentId: string;
      action: 'CREATED' | 'CORRECTED';
    }
  | {
      candidateId: string;
      ok: false;
      code:
        | 'NOT_FOUND'
        | 'ALREADY_RESOLVED'
        | 'AREA_AJENA'
        | 'VERSION_CAMBIO'
        | 'DOCUMENTO_AUSENTE'
        | 'DUPLICADO_EXACTO'
        | 'ERROR';
      currentVersion?: number;
      message?: string;
    };

/**
 * La revisión de la entrevista (spec 010, US2): una ficha por respuesta,
 * editable, con el aviso de parecido calculado ANTES de escribir (FR-029,
 * D6) y la aprobación como único camino al corpus (Principio III).
 */
@Injectable()
export class InterviewsCandidatesService {
  private readonly logger = new Logger(InterviewsCandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly drafting: InterviewsDraftingService,
  ) {}

  // ==========================================================================
  // Cerrar: una ficha por respuesta útil
  // ==========================================================================

  /**
   * Llamado por `InterviewCloseProcessor` (Principio IV). FR-024: un
   * candidato por respuesta **útil** — solo las preguntas `RESPONDIDA`, no
   * las salteadas ni las que quedaron `SIN_RESPONDER`.
   */
  async runClose(sessionId: string): Promise<void> {
    try {
      const preguntas = await this.prisma.interviewQuestion.findMany({
        where: { sessionId, status: 'RESPONDIDA' },
        orderBy: { order: 'asc' },
      });

      for (const pregunta of preguntas) {
        const respuesta = await this.prisma.interviewAnswer.findFirst({
          where: { questionId: pregunta.id },
          orderBy: { attempt: 'desc' },
        });
        // Defensivo: RESPONDIDA solo se marca junto con crear la respuesta,
        // así que esto no debería faltar nunca.
        if (!respuesta) continue;

        const ficha = await this.drafting.redactarFicha({
          kind: pregunta.kind,
          preguntaTexto: pregunta.text,
          respuestaCruda: respuesta.text,
        });

        if (!ficha) {
          await this.prisma.interviewCandidate.create({
            data: {
              sessionId,
              questionId: pregunta.id,
              status: InterviewCandidateStatus.FALLIDO,
              title: '',
              category: pregunta.themeLabel ?? 'Entrevista',
              proposedContent: '',
              failureReason:
                'No se pudo redactar una ficha a partir de esta respuesta.',
            },
          });
          continue;
        }

        const esCorreccion = pregunta.documentId != null;
        await this.prisma.interviewCandidate.create({
          data: {
            sessionId,
            questionId: pregunta.id,
            status: InterviewCandidateStatus.PENDIENTE,
            title: ficha.title,
            category: pregunta.themeLabel ?? 'Entrevista',
            proposedContent: ficha.content,
            targetDocumentId: esCorreccion ? pregunta.documentId : null,
            targetVersion: esCorreccion ? pregunta.documentVersion : null,
          },
        });
      }

      await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: { status: InterviewStatus.EN_REVISION },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cierre de ${sessionId} falló: ${message}`);
      await this.prisma.interviewSession
        .update({
          where: { id: sessionId },
          data: { status: InterviewStatus.FALLIDA, failureReason: message },
        })
        .catch(() => {
          // No perder el error original si esto también falla.
        });
    }
  }

  // ==========================================================================
  // Revisar
  // ==========================================================================

  /**
   * FR-032, primera mitad: la aprobación es gobernanza de área, no del
   * dueño de la sesión — cualquier responsable del área puede revisar y
   * aprobar, no solo quien la abrió.
   */
  private async cargarSesionDelArea(sessionId: string, empleadoId: string) {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    const permitido = await this.knowledge.esResponsableDeAgente(
      empleadoId,
      session.agentType,
    );
    if (!permitido) {
      throw new ForbiddenException('No sos responsable de esta área');
    }
    return session;
  }

  async list(sessionId: string, empleadoId: string) {
    const session = await this.cargarSesionDelArea(sessionId, empleadoId);

    const candidatos = await this.prisma.interviewCandidate.findMany({
      where: { sessionId },
      include: { question: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      sessionId,
      status: session.status,
      candidates: await Promise.all(
        candidatos.map((c) =>
          this.candidateView(c, session.agentType, empleadoId),
        ),
      ),
    };
  }

  private async candidateView(
    candidate: {
      id: string;
      status: InterviewCandidateStatus;
      title: string;
      proposedContent: string;
      editedContent: string | null;
      audience: Audience;
      targetDocumentId: string | null;
      targetVersion: number | null;
      applyMode: CandidateApplyMode;
      questionId: string;
      question: { order: number; text: string; origin: string };
    },
    agentType: string,
    empleadoId: string,
  ) {
    const content = candidate.editedContent ?? candidate.proposedContent;

    const respuesta = await this.prisma.interviewAnswer.findFirst({
      where: { questionId: candidate.questionId },
      orderBy: { attempt: 'desc' },
    });

    let target: {
      documentId: string;
      title: string;
      version: number;
      currentContent: string;
      changedSinceOpen: boolean;
    } | null = null;
    if (candidate.targetDocumentId) {
      const doc = await this.prisma.knowledgeDocument.findUnique({
        where: { id: candidate.targetDocumentId },
        select: { id: true, title: true, version: true, content: true },
      });
      target = doc
        ? {
            documentId: doc.id,
            title: doc.title,
            version: doc.version,
            // Lo que el documento dice HOY. Sin esto, quien aprueba decide
            // entre agregar y reemplazar a ciegas — y reemplazar borra algo
            // que no está viendo.
            currentContent: doc.content,
            changedSinceOpen:
              candidate.targetVersion != null &&
              doc.version !== candidate.targetVersion,
          }
        : null;
    }

    // FR-029/D6: se calcula acá, ANTES de escribir nada. Vacío en las
    // correcciones — ya apuntan a un documento, no hay nada que evitar.
    const similar =
      !candidate.targetDocumentId &&
      candidate.status === InterviewCandidateStatus.PENDIENTE
        ? (await this.knowledge.buscarParecidos(content, Audience.INTERNO)).map(
            (p) => ({
              documentId: p.documentId,
              title: p.title,
              score: p.score,
              audienciaDistinta: p.audienciaDistinta,
            }),
          )
        : [];

    const canApprove = await this.knowledge.esResponsableDeAgente(
      empleadoId,
      agentType as never,
    );

    return {
      id: candidate.id,
      status: candidate.status,
      candidateKind: candidate.targetDocumentId ? 'CORRECCION' : 'NUEVO',
      // Solo tiene sentido en una corrección: un documento nuevo no tiene a
      // qué agregarse.
      applyMode: candidate.targetDocumentId ? candidate.applyMode : null,
      title: candidate.title,
      content,
      edited: candidate.editedContent != null,
      audience: candidate.audience,
      question: {
        order: candidate.question.order,
        text: candidate.question.text,
        origin: candidate.question.origin,
      },
      rawAnswer: respuesta?.text ?? '',
      target,
      similar,
      canApprove,
    };
  }

  async patch(
    candidateId: string,
    input: {
      title?: string;
      content?: string;
      audience?: Audience;
      targetDocumentId?: string | null;
      applyMode?: CandidateApplyMode;
    },
    empleadoId: string,
  ) {
    const candidate = await this.prisma.interviewCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    await this.cargarSesionDelArea(candidate.sessionId, empleadoId);

    if (candidate.status !== InterviewCandidateStatus.PENDIENTE) {
      throw new ConflictException('Este candidato ya se resolvió.');
    }

    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.content !== undefined) data.editedContent = input.content;
    if (input.audience !== undefined) data.audience = input.audience;
    // Agregar o pisar. Solo se decide en una corrección; en un candidato nuevo
    // no hay a qué agregarse y el valor queda inerte.
    if (input.applyMode !== undefined) data.applyMode = input.applyMode;
    if ('targetDocumentId' in input) {
      data.targetDocumentId = input.targetDocumentId;
      if (input.targetDocumentId) {
        const doc = await this.prisma.knowledgeDocument.findUnique({
          where: { id: input.targetDocumentId },
          select: { version: true },
        });
        data.targetVersion = doc?.version ?? null;
      } else {
        data.targetVersion = null;
      }
    }

    return this.prisma.interviewCandidate.update({
      where: { id: candidateId },
      data,
    });
  }

  // ==========================================================================
  // Aprobar / descartar
  // ==========================================================================

  /** FR-027: un fallo no cancela los demás — un resultado por candidato. */
  async approve(
    ids: string[],
    empleadoId: string,
  ): Promise<{
    results: ApproveResult[];
    sessionStatus: InterviewStatus | null;
  }> {
    const results: ApproveResult[] = [];
    let sessionId: string | null = null;

    for (const id of ids) {
      const candidate = await this.prisma.interviewCandidate.findUnique({
        where: { id },
        include: { question: true },
      });
      if (!candidate) {
        results.push({ candidateId: id, ok: false, code: 'NOT_FOUND' });
        continue;
      }
      sessionId = candidate.sessionId;

      if (candidate.status !== InterviewCandidateStatus.PENDIENTE) {
        results.push({ candidateId: id, ok: false, code: 'ALREADY_RESOLVED' });
        continue;
      }

      const session = await this.prisma.interviewSession.findUniqueOrThrow({
        where: { id: candidate.sessionId },
      });

      // FR-032: revalidada POR CANDIDATO — la sesión se abrió con permiso
      // que puede haberse perdido mientras tanto.
      const permitido = await this.knowledge.esResponsableDeAgente(
        empleadoId,
        session.agentType,
      );
      if (!permitido) {
        results.push({ candidateId: id, ok: false, code: 'AREA_AJENA' });
        continue;
      }

      const contenido = candidate.editedContent ?? candidate.proposedContent;

      try {
        if (candidate.targetDocumentId) {
          const resultado = await this.aprobarCorreccion(
            candidate as never,
            contenido,
            empleadoId,
          );
          if (!resultado.ok) {
            results.push({ candidateId: id, ...resultado } as ApproveResult);
            continue;
          }
          results.push({
            candidateId: id,
            ok: true,
            documentId: resultado.documentId,
            action: 'CORRECTED',
          });
        } else {
          const documentId = await this.aprobarNuevo(
            candidate as never,
            contenido,
            session.id,
            session.agentType,
            empleadoId,
          );
          results.push({
            candidateId: id,
            ok: true,
            documentId,
            action: 'CREATED',
          });

          // FR-035a/b: si viene de un escalado pendiente, cierra el caso —
          // sin enviarle nada al usuario original.
          if (
            candidate.question.origin === 'ESCALADO_PENDIENTE' &&
            candidate.question.escalationId
          ) {
            await this.prisma.escalation.update({
              where: { id: candidate.question.escalationId },
              data: {
                status: 'RESOLVED',
                resolvedById: empleadoId,
                resolution: contenido,
                resolvedAt: new Date(),
              },
            });
          }
        }
      } catch (err) {
        if (
          err instanceof ConflictException &&
          (err.getResponse() as Record<string, unknown>).reason ===
            'DUPLICATE_DOCUMENT'
        ) {
          results.push({
            candidateId: id,
            ok: false,
            code: 'DUPLICADO_EXACTO',
          });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Aprobación del candidato ${id} falló: ${message}`);
          results.push({ candidateId: id, ok: false, code: 'ERROR', message });
        }
      }
    }

    let sessionStatus: InterviewStatus | null = null;
    if (sessionId) {
      sessionStatus = await this.cerrarSiCorresponde(sessionId);
    }

    return { results, sessionStatus };
  }

  /**
   * Aplica una corrección a un documento existente.
   *
   * ⚠️ **Por defecto AGREGA, no reemplaza.** La pregunta que originó la ficha
   * fue "¿qué le FALTA a este documento?", y quien la redacta —el modelo— no
   * ve el documento original: solo la respuesta. Escribir esa ficha como
   * contenido entero borra todo lo que el documento ya decía.
   *
   * Pasó de verdad: «Sobre Nosotros» quedó hablando solo de facturas después
   * de una entrevista sobre facturación. Quien aprueba puede elegir
   * `REEMPLAZAR` cuando de verdad quiere pisar el texto, pero tiene que ser
   * una decisión, no el default.
   */
  private async aprobarCorreccion(
    candidate: {
      id: string;
      targetDocumentId: string;
      targetVersion: number | null;
      applyMode: CandidateApplyMode;
    },
    contenido: string,
    empleadoId: string,
  ): Promise<
    | { ok: true; documentId: string }
    | {
        ok: false;
        code: 'DOCUMENTO_AUSENTE' | 'VERSION_CAMBIO';
        currentVersion?: number;
      }
  > {
    // FR-031: si el documento se borró o desactivó, no se corrige a ciegas.
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: candidate.targetDocumentId },
    });
    if (!doc || !doc.isActive) {
      return { ok: false, code: 'DOCUMENTO_AUSENTE' };
    }

    // La regla se consulta, no se escribe acá: `componerContenido` es el punto
    // único, y la resolución de un caso escalado (spec 007) usa el mismo.
    const contenidoFinal = componerContenido(
      candidate.applyMode,
      doc.content,
      contenido,
    );

    try {
      await this.knowledge.update(
        candidate.targetDocumentId,
        {
          content: contenidoFinal,
          origin: 'AI_ACCEPTED' as never,
          expectedVersion: candidate.targetVersion ?? doc.version,
        },
        empleadoId,
      );
    } catch (err) {
      if (
        err instanceof ConflictException &&
        (err.getResponse() as Record<string, unknown>).reason ===
          'VERSION_CONFLICT'
      ) {
        return {
          ok: false,
          code: 'VERSION_CAMBIO',
          currentVersion: (err.getResponse() as Record<string, unknown>)
            .currentVersion as number,
        };
      }
      throw err;
    }

    await this.prisma.interviewCandidate.update({
      where: { id: candidate.id },
      data: {
        status: InterviewCandidateStatus.APROBADO,
        resultDocumentId: candidate.targetDocumentId,
        resolvedById: empleadoId,
        resolvedAt: new Date(),
      },
    });

    return { ok: true, documentId: candidate.targetDocumentId };
  }

  private async aprobarNuevo(
    candidate: {
      id: string;
      title: string;
      category: string;
      audience: Audience;
    },
    contenido: string,
    sessionId: string,
    agentType: string,
    empleadoId: string,
  ): Promise<string> {
    const { documentId } = await this.knowledge.ingest({
      title: candidate.title,
      content: contenido,
      category: candidate.category,
      audience: candidate.audience,
      agentType: agentType as never,
      sourceType: 'ENTREVISTA' as never,
      // Apunta a la SESIÓN, no al candidato (schema.prisma:633, FR-034):
      // varias fichas pueden salir de la misma sesión, y "de qué entrevista
      // salió esto" es la pregunta que se hace leyendo el corpus, no "de
      // qué ficha puntual".
      sourceId: sessionId,
    });

    await this.prisma.interviewCandidate.update({
      where: { id: candidate.id },
      data: {
        status: InterviewCandidateStatus.APROBADO,
        resultDocumentId: documentId,
        resolvedById: empleadoId,
        resolvedAt: new Date(),
      },
    });

    return documentId;
  }

  async discard(candidateId: string, empleadoId: string) {
    const candidate = await this.prisma.interviewCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');
    await this.cargarSesionDelArea(candidate.sessionId, empleadoId);

    if (candidate.status !== InterviewCandidateStatus.PENDIENTE) {
      throw new ConflictException('Este candidato ya se resolvió.');
    }

    await this.prisma.interviewCandidate.update({
      where: { id: candidateId },
      data: {
        status: InterviewCandidateStatus.DESCARTADO,
        resolvedById: empleadoId,
        resolvedAt: new Date(),
      },
    });

    const sessionStatus = await this.cerrarSiCorresponde(candidate.sessionId);
    return { discarded: true, sessionStatus };
  }

  /**
   * FR-050/T050: `CERRADA` cuando no queda ningún `PENDIENTE`. Aprobados y
   * descartados cuentan igual — lo que importa es que se revisaron.
   */
  private async cerrarSiCorresponde(
    sessionId: string,
  ): Promise<InterviewStatus> {
    const pendientes = await this.prisma.interviewCandidate.count({
      where: { sessionId, status: InterviewCandidateStatus.PENDIENTE },
    });
    if (pendientes > 0) {
      const session = await this.prisma.interviewSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      return session.status;
    }

    const session = await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: { status: InterviewStatus.CERRADA, closedAt: new Date() },
    });
    return session.status;
  }
}
