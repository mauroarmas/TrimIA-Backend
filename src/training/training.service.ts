import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Audience, AudioStatus, PillStatus, TrainingProgressStatus } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AudioStorageService, AudioStreamResult } from './services/audio-storage.service';
import { AudioScriptDto, UpdateAudioScriptDto } from './dto/audio-script.dto';
import { AudioStatusResponseDto } from './dto/audio-status.dto';
import { PlaybackProgressResponseDto, ReportPlaybackProgressDto } from './dto/playback-progress.dto';
import { PrismaService } from '../database/prisma.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { TrainingGeneratorService } from './training-generator.service';
import { GeneratePillDto } from './dto/generate-pill.dto';
import { UpdatePillDto } from './dto/update-pill.dto';
import { PublishPillDto } from './dto/publish-pill.dto';
import { CreateModuleDto } from './dto/create-module.dto';
import {
  EmployeeModuleSummaryDto,
  EmployeePillDetailDto,
  EmployeePillSummaryDto,
} from './dto/employee-training.dto';
import { VerificationQuestion } from './dto/training-common.dto';
import { QuizVerificationResult } from './dto/verify-quiz.dto';
import {
  DiagnosticQuestionDto,
  DiagnosticQuizResponseDto,
} from './dto/diagnostic-quiz.dto';
import { SubmitDiagnosticDto } from './dto/submit-diagnostic.dto';
import { DiagnosticResultDto } from './dto/diagnostic-result.dto';
import { SupervisorDiagnosticDetailResponseDto } from './dto/supervisor-diagnostic.dto';

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly generator: TrainingGeneratorService,
    private readonly audioStorageService: AudioStorageService,
    @InjectQueue('training-audio') private readonly audioQueue: Queue,
  ) {}

  private extractQuizQuestions(rawQuiz: any): VerificationQuestion[] {
    if (!rawQuiz) return [];
    if (Array.isArray(rawQuiz)) return rawQuiz;
    if (rawQuiz && Array.isArray(rawQuiz.questions)) return rawQuiz.questions;
    return [];
  }


  /**
   * Crea un nuevo módulo formativo (Solo supervisores con permiso).
   */
  async createModule(supervisorId: string, dto: CreateModuleDto) {
    let agentType = null;
    if (dto.sectorId) {
      const sector = await this.prisma.sector.findUnique({
        where: { id: dto.sectorId },
      });
      if (!sector) throw new NotFoundException(`Sector ${dto.sectorId} no encontrado`);
      agentType = sector.agentType;
    }

    // Validación de sector (Principio I)
    await this.knowledge.assertPuedeEscribir(supervisorId, agentType);

    return this.prisma.trainingModule.create({
      data: {
        title: dto.title,
        description: dto.description,
        sectorId: dto.sectorId,
        orderIndex: dto.orderIndex ?? 0,
      },
      include: { sector: true },
    });
  }

  /**
   * Lista todos los módulos con todas sus píldoras (incluidos borradores) para supervisión.
   */
  async getSupervisorModules() {
    return this.prisma.trainingModule.findMany({
      orderBy: { orderIndex: 'asc' },
      include: {
        sector: true,
        pills: {
          orderBy: { orderIndex: 'asc' },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
            publishedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  /**
   * Genera y persiste una propuesta de píldora en estado DRAFT (US1).
   */
  async generatePillDraft(supervisorId: string, dto: GeneratePillDto) {
    const module = await this.prisma.trainingModule.findUnique({
      where: { id: dto.moduleId },
      include: { sector: true },
    });
    if (!module) {
      throw new NotFoundException(`Módulo de capacitación ${dto.moduleId} no encontrado`);
    }

    // Validación de gobernanza por sector (Principio I)
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      module.sector?.agentType ?? null,
    );

    // Generación asistida con IA
    const proposal = await this.generator.generatePillProposal(
      dto.topic,
      module.sectorId,
      dto.additionalNotes,
    );

    // Calcular orden secuencial dentro del módulo
    const lastPill = await this.prisma.pill.findFirst({
      where: { moduleId: module.id },
      orderBy: { orderIndex: 'desc' },
      select: { orderIndex: true },
    });
    const orderIndex = lastPill ? lastPill.orderIndex + 1 : 0;

    // Persistir como DRAFT
    const pill = await this.prisma.pill.create({
      data: {
        moduleId: module.id,
        title: proposal.title,
        objective: proposal.objective,
        content: proposal.content,
        quiz: proposal.quiz as unknown as any,
        status: PillStatus.DRAFT,
        orderIndex,
        createdById: supervisorId,
      },
      include: { module: { include: { sector: true } } },
    });

    this.logger.log(`Píldora "${pill.title}" generada en DRAFT para módulo ${module.title} por supervisor ${supervisorId}`);
    return pill;
  }

  /**
   * Actualiza el contenido o preguntas de una píldora en borrador (US2).
   */
  async updatePill(supervisorId: string, pillId: string, dto: UpdatePillDto) {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });
    if (!pill) throw new NotFoundException(`Píldora ${pillId} no encontrada`);

    // Solo se pueden editar píldoras en DRAFT
    if (pill.status !== PillStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden editar píldoras en estado DRAFT');
    }

    // Validación de sector
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    return this.prisma.pill.update({
      where: { id: pillId },
      data: {
        title: dto.title ?? pill.title,
        objective: dto.objective ?? pill.objective,
        content: dto.content ?? pill.content,
        quiz: dto.quiz ? (dto.quiz as unknown as any) : pill.quiz,
        orderIndex: dto.orderIndex ?? pill.orderIndex,
      },
      include: { module: { include: { sector: true } } },
    });
  }

  /**
   * Aprueba y publica una píldora (US2). Opcionalmente la ingresa al corpus RAG.
   */
  async publishPill(supervisorId: string, pillId: string, dto: PublishPillDto) {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });
    if (!pill) throw new NotFoundException(`Píldora ${pillId} no encontrada`);

    if (pill.status !== PillStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden publicar píldoras en estado DRAFT');
    }

    // Validación de sector
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    const publishedPill = await this.prisma.pill.update({
      where: { id: pillId },
      data: {
        status: PillStatus.PUBLISHED,
        publishedById: supervisorId,
        publishedAt: new Date(),
      },
      include: { module: { include: { sector: true } } },
    });

    // Ingesta opcional en RAG con verificación anti-duplicados (spec 007)
    if (dto.indexInKnowledge) {
      try {
        await this.knowledge.ingest({
          title: `Capacitación: ${pill.title}`,
          content: `${pill.objective}\n\n${pill.content}`,
          category: 'CAPACITACION',
          audience: Audience.INTERNO,
          agentType: pill.module.sector?.agentType ?? null,
          sourceId: pill.id,
        });
        this.logger.log(`Píldora ${pill.title} indexada en la base de conocimiento`);
      } catch (err) {
        this.logger.warn(`No se pudo indexar píldora en conocimiento (posible duplicado exacto): ${err}`);
      }
    }

    return publishedPill;
  }

  /**
   * Archiva una píldora retirándola de la capacitación activa.
   */
  async archivePill(supervisorId: string, pillId: string) {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });
    if (!pill) throw new NotFoundException(`Píldora ${pillId} no encontrada`);

    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    return this.prisma.pill.update({
      where: { id: pillId },
      data: { status: PillStatus.ARCHIVED },
    });
  }

  /**
   * Lista los módulos y píldoras publicados para un empleado con candados dinámicos (US3).
   */
  async getEmployeeModules(employeeId: string): Promise<EmployeeModuleSummaryDto[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { sectorId: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    const modules = await this.prisma.trainingModule.findMany({
      where: {
        isActive: true,
        OR: [{ sectorId: employee.sectorId }, { sectorId: null }],
      },
      orderBy: { orderIndex: 'asc' },
      include: {
        pills: {
          where: { status: PillStatus.PUBLISHED },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    const progressRecords = await this.prisma.employeeProgress.findMany({
      where: { employeeId },
      select: { pillId: true, status: true },
    });
    const progressMap = new Map(progressRecords.map((pr) => [pr.pillId, pr.status]));
    const approvedSet = new Set(
      progressRecords
        .filter(
          (pr) =>
            pr.status === TrainingProgressStatus.COMPLETED ||
            pr.status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
        )
        .map((pr) => pr.pillId),
    );

    return modules.map((mod) => {
      let previousPillApproved = true; // La primera píldora siempre arranca desbloqueada

      const pillsSummary: EmployeePillSummaryDto[] = mod.pills.map((p, idx) => {
        const isApproved = approvedSet.has(p.id);
        const status = progressMap.get(p.id) ?? TrainingProgressStatus.NOT_STARTED;
        const isLocked = idx === 0 ? false : !previousPillApproved;
        previousPillApproved = isApproved;

        return {
          id: p.id,
          title: p.title,
          objective: p.objective,
          orderIndex: p.orderIndex,
          isCompleted: isApproved,
          isExempted: status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
          status,
          isLocked,
        };
      });

      return {
        id: mod.id,
        title: mod.title,
        description: mod.description,
        pillsCount: pillsSummary.length,
        completedPillsCount: pillsSummary.filter((p) => p.isCompleted).length,
        pills: pillsSummary,
      };
    });
  }

  /**
   * Obtiene el contenido de una píldora para lectura del empleado (US3).
   * Oculta las respuestas correctas del quiz.
   */
  async getEmployeePill(employeeId: string, pillId: string): Promise<EmployeePillDetailDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { sectorId: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: true },
    });
    if (!pill || pill.status !== PillStatus.PUBLISHED) {
      throw new NotFoundException('Píldora no encontrada o no disponible');
    }

    // Validación de sector (el empleado solo accede a su sector o módulos transversales generales)
    if (pill.module.sectorId && pill.module.sectorId !== employee.sectorId) {
      throw new ForbiddenException('No tiene acceso a capacitaciones de este sector');
    }

    // Validación de candados si no es la primera píldora
    if (pill.orderIndex > 0) {
      const prevPill = await this.prisma.pill.findFirst({
        where: {
          moduleId: pill.moduleId,
          status: PillStatus.PUBLISHED,
          orderIndex: { lt: pill.orderIndex },
        },
        orderBy: { orderIndex: 'desc' },
      });

      if (prevPill) {
        const prevProgress = await this.prisma.employeeProgress.findUnique({
          where: { employeeId_pillId: { employeeId, pillId: prevPill.id } },
        });

        if (
          prevProgress?.status !== TrainingProgressStatus.COMPLETED &&
          prevProgress?.status !== TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC
        ) {
          throw new ForbiddenException('La píldora está bloqueada. Debe completar la lección previa.');
        }
      }
    }

    const currentProgress = await this.prisma.employeeProgress.findUnique({
      where: { employeeId_pillId: { employeeId, pillId } },
    });

    const quizRaw = this.extractQuizQuestions(pill.quiz);
    const safeQuiz = quizRaw.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
    }));

    const isExempted = currentProgress?.status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC;
    const isCompleted =
      currentProgress?.status === TrainingProgressStatus.COMPLETED || isExempted;

    return {
      id: pill.id,
      moduleId: pill.moduleId,
      title: pill.title,
      objective: pill.objective,
      content: pill.content,
      orderIndex: pill.orderIndex,
      isCompleted,
      isExempted,
      status: currentProgress?.status ?? TrainingProgressStatus.NOT_STARTED,
      isLocked: false,
      quiz: safeQuiz,
      audioStatus: pill.audioStatus,
      audioDurationSeconds: pill.audioDurationSeconds,
      hasAudio: pill.audioStatus === AudioStatus.AUDIO_READY,
      isAudioCompleted: currentProgress?.isAudioCompleted ?? false,
      playbackProgressSeconds: currentProgress?.playbackProgressSeconds ?? 0,
      streamUrl: pill.audioStatus === AudioStatus.AUDIO_READY ? ('/training/pills/' + pill.id + '/audio') : null,
    };
  }

  /**
   * Valida las respuestas enviadas por el empleado para el quiz de la píldora (US4).
   */
  async verifyQuiz(
    employeeId: string,
    pillId: string,
    answers: number[],
  ): Promise<QuizVerificationResult> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: true },
    });
    if (!pill || pill.status !== PillStatus.PUBLISHED) {
      throw new NotFoundException('Píldora no encontrada');
    }

    const quiz = this.extractQuizQuestions(pill.quiz);
    if (quiz.length === 0) {
      throw new BadRequestException('Esta píldora no posee preguntas de verificación');
    }

    const failedIndices: number[] = [];
    const explanations: string[] = [];

    quiz.forEach((q, idx) => {
      explanations.push(q.explanation);
      if (answers[idx] !== q.correctOptionIndex) {
        failedIndices.push(idx);
      }
    });

    const passed = failedIndices.length === 0;

    // Actualizar o crear registro en EmployeeProgress
    const existingProgress = await this.prisma.employeeProgress.findUnique({
      where: { employeeId_pillId: { employeeId, pillId } },
    });

    const newAttempts = (existingProgress?.attempts ?? 0) + 1;

    let nextPillId: string | null = null;

    if (passed) {
      await this.prisma.employeeProgress.upsert({
        where: { employeeId_pillId: { employeeId, pillId } },
        create: {
          employeeId,
          pillId,
          status: TrainingProgressStatus.COMPLETED,
          attempts: newAttempts,
          lastAnswers: answers,
          completedAt: new Date(),
        },
        update: {
          status: TrainingProgressStatus.COMPLETED,
          attempts: newAttempts,
          lastAnswers: answers,
          completedAt: new Date(),
        },
      });

      // Buscar siguiente píldora desbloqueada
      const nextPill = await this.prisma.pill.findFirst({
        where: {
          moduleId: pill.moduleId,
          status: PillStatus.PUBLISHED,
          orderIndex: { gt: pill.orderIndex },
        },
        orderBy: { orderIndex: 'asc' },
        select: { id: true },
      });
      nextPillId = nextPill?.id ?? null;
    } else {
      await this.prisma.employeeProgress.upsert({
        where: { employeeId_pillId: { employeeId, pillId } },
        create: {
          employeeId,
          pillId,
          status: TrainingProgressStatus.IN_PROGRESS,
          attempts: newAttempts,
          lastAnswers: answers,
        },
        update: {
          status: existingProgress?.status === TrainingProgressStatus.COMPLETED
            ? TrainingProgressStatus.COMPLETED
            : TrainingProgressStatus.IN_PROGRESS,
          attempts: newAttempts,
          lastAnswers: answers,
        },
      });
    }

    return {
      passed,
      failedIndices,
      explanations,
      nextPillId,
    };
  }

  /**
   * Genera el cuestionario diagnóstico inicial sanitizado (US1).
   * Selecciona de 5 a 8 preguntas de píldoras publicadas del sector y transversales.
   * Oculta rigurosamente correctOptionIndex y explanation.
   */
  async getDiagnosticQuestions(employeeId: string): Promise<DiagnosticQuizResponseDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, sectorId: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    // Comprobar si ya rindió un diagnóstico no reseteado (US1 / FR-009)
    const existingSession = await this.prisma.diagnosticSession.findFirst({
      where: { employeeId, isReset: false },
    });
    if (existingSession) {
      throw new BadRequestException('El empleado ya ha completado su evaluación diagnóstica inicial');
    }

    // Obtener módulos del sector y generales
    const modules = await this.prisma.trainingModule.findMany({
      where: {
        isActive: true,
        OR: [{ sectorId: employee.sectorId }, { sectorId: null }],
      },
      orderBy: { orderIndex: 'asc' },
      include: {
        pills: {
          where: { status: PillStatus.PUBLISHED },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    // Recolectar todas las preguntas candidatas agrupadas por módulo
    const moduleQuestionsMap: Map<string, DiagnosticQuestionDto[]> = new Map();

    for (const mod of modules) {
      const qList: DiagnosticQuestionDto[] = [];
      for (const pill of mod.pills) {
        const quiz = this.extractQuizQuestions(pill.quiz);
        for (const q of quiz) {
          qList.push({
            moduleId: mod.id,
            moduleTitle: mod.title,
            pillId: pill.id,
            pillTitle: pill.title,
            questionId: q.id,
            question: q.question,
            options: q.options,
          });
        }
      }
      if (qList.length > 0) {
        moduleQuestionsMap.set(mod.id, qList);
      }
    }

    // Muestreo balanceado: entre 5 y 8 preguntas
    const allCandidates: DiagnosticQuestionDto[] = [];
    moduleQuestionsMap.forEach((qList) => allCandidates.push(...qList));

    if (allCandidates.length <= 8) {
      return {
        totalQuestions: allCandidates.length,
        estimatedMinutes: 5,
        questions: allCandidates,
      };
    }

    // Si hay más de 8 preguntas, balancear round-robin por módulo hasta llegar a 8
    const selectedQuestions: DiagnosticQuestionDto[] = [];
    const moduleEntries = Array.from(moduleQuestionsMap.values());
    let index = 0;
    while (selectedQuestions.length < 8) {
      let addedInRound = false;
      for (const list of moduleEntries) {
        if (index < list.length && selectedQuestions.length < 8) {
          selectedQuestions.push(list[index]);
          addedInRound = true;
        }
      }
      if (!addedInRound) break;
      index++;
    }

    return {
      totalQuestions: selectedQuestions.length,
      estimatedMinutes: 5,
      questions: selectedQuestions,
    };
  }

  /**
   * Califica la evaluación diagnóstica inicial y aplica exención temática (US2).
   * 100% de aciertos en preguntas de un módulo otorga EXEMPTED_BY_DIAGNOSTIC en todas sus píldoras.
   */
  async submitDiagnostic(
    employeeId: string,
    dto: SubmitDiagnosticDto,
  ): Promise<DiagnosticResultDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    const existingSession = await this.prisma.diagnosticSession.findFirst({
      where: { employeeId, isReset: false },
    });
    if (existingSession) {
      throw new BadRequestException('El empleado ya ha completado su evaluación diagnóstica inicial');
    }

    if (!dto.answers || dto.answers.length === 0) {
      throw new BadRequestException('No se enviaron respuestas para calificar');
    }

    // Cargar píldoras involucradas
    const pillIds: string[] = Array.from(new Set(dto.answers.map((a) => a.pillId)));
    const pills = await this.prisma.pill.findMany({
      where: { id: { in: pillIds }, status: PillStatus.PUBLISHED },
      include: { module: true },
    });
    const pillMap = new Map<string, any>(pills.map((p) => [p.id, p]));

    const answersEvaluated: Array<{
      pillId: string;
      questionId: number;
      selectedOptionIndex: number;
      isCorrect: boolean;
      moduleId: string;
    }> = [];

    const moduleStats = new Map<string, { total: number; correct: number; moduleTitle: string }>();

    for (const ans of dto.answers) {
      const pill = pillMap.get(ans.pillId);
      if (!pill) {
        throw new BadRequestException(`Píldora ${ans.pillId} no encontrada o no publicada`);
      }
      const quiz = this.extractQuizQuestions(pill.quiz);
      const question = quiz.find((q) => Number(q.id) === Number(ans.questionId));
      if (!question) {
        throw new BadRequestException(`Pregunta ${ans.questionId} no encontrada en la píldora ${ans.pillId}`);
      }

      const isCorrect = ans.selectedOptionIndex === question.correctOptionIndex;
      const moduleId = pill.moduleId;

      answersEvaluated.push({
        pillId: ans.pillId,
        questionId: ans.questionId,
        selectedOptionIndex: ans.selectedOptionIndex,
        isCorrect,
        moduleId,
      });

      const currentStats = moduleStats.get(moduleId) || {
        total: 0,
        correct: 0,
        moduleTitle: pill.module.title,
      };
      currentStats.total += 1;
      if (isCorrect) currentStats.correct += 1;
      moduleStats.set(moduleId, currentStats);
    }

    const totalQuestions = answersEvaluated.length;
    const totalCorrect = answersEvaluated.filter((a) => a.isCorrect).length;
    const overallScore = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;

    const exemptedModules: Array<{ id: string; title: string }> = [];
    const pendingModules: Array<{ id: string; title: string }> = [];

    for (const [moduleId, stats] of moduleStats.entries()) {
      if (stats.total > 0 && stats.correct === stats.total) {
        exemptedModules.push({ id: moduleId, title: stats.moduleTitle });

        // Marcar todas las píldoras del módulo con EXEMPTED_BY_DIAGNOSTIC
        const modulePills = await this.prisma.pill.findMany({
          where: { moduleId, status: PillStatus.PUBLISHED },
          select: { id: true },
        });

        for (const p of modulePills) {
          await this.prisma.employeeProgress.upsert({
            where: { employeeId_pillId: { employeeId, pillId: p.id } },
            create: {
              employeeId,
              pillId: p.id,
              status: TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
              completedAt: new Date(),
            },
            update: {
              status: TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
              completedAt: new Date(),
            },
          });
        }
      } else {
        pendingModules.push({ id: moduleId, title: stats.moduleTitle });
      }
    }

    const session = await this.prisma.diagnosticSession.create({
      data: {
        employeeId,
        score: Math.round(overallScore * 10) / 10,
        totalQuestions,
        correctAnswers: totalCorrect,
        exemptedModuleIds: exemptedModules.map((m) => m.id),
        answers: answersEvaluated,
        isReset: false,
      },
    });

    const message =
      exemptedModules.length > 0
        ? `¡Felicitaciones! Has obtenido exención total en ${exemptedModules.length} módulo(s).`
        : 'Diagnóstico completado. Se han configurado tus rutas de aprendizaje.';

    return {
      sessionId: session.id,
      score: session.score,
      totalQuestions,
      correctAnswers: totalCorrect,
      exemptedModules,
      pendingModules,
      message,
    };
  }

  /**
   * Obtiene el historial y resultados del diagnóstico de un empleado para supervisión (US4).
   * Valida assertPuedeEscribir sobre el sector del empleado (Principio I).
   */
  async getSupervisorEmployeeDiagnostic(
    supervisorId: string,
    employeeId: string,
  ): Promise<SupervisorDiagnosticDetailResponseDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { sector: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    // Validación de sector (Principio I)
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      employee.sector?.agentType ?? null,
    );

    const latestSession = await this.prisma.diagnosticSession.findFirst({
      where: { employeeId },
      orderBy: { completedAt: 'desc' },
    });

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      sectorName: employee.sector?.name ?? 'General',
      hasCompletedDiagnostic: !!latestSession && !latestSession.isReset,
      lastSession: latestSession
        ? {
            sessionId: latestSession.id,
            score: latestSession.score,
            completedAt: latestSession.completedAt,
            totalQuestions: latestSession.totalQuestions,
            correctAnswers: latestSession.correctAnswers,
            exemptedModuleIds: latestSession.exemptedModuleIds,
            isReset: latestSession.isReset,
          }
        : null,
    };
  }

  /**
   * Reinicia la evaluación diagnóstica de un empleado (US4 / Principio III).
   * Archiva la sesión activa (isReset = true) y restablece a NOT_STARTED las píldoras eximidas.
   */
  async resetEmployeeDiagnostic(supervisorId: string, employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { sector: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    // Validación de sector (Principio I)
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      employee.sector?.agentType ?? null,
    );

    const activeSession = await this.prisma.diagnosticSession.findFirst({
      where: { employeeId, isReset: false },
    });
    if (!activeSession) {
      throw new NotFoundException('El empleado no posee una evaluación diagnóstica activa para reiniciar');
    }

    // Archivar sesión
    await this.prisma.diagnosticSession.update({
      where: { id: activeSession.id },
      data: {
        isReset: true,
        resetById: supervisorId,
        resetAt: new Date(),
      },
    });

    // Revertir píldoras con estado EXEMPTED_BY_DIAGNOSTIC a NOT_STARTED
    await this.prisma.employeeProgress.updateMany({
      where: {
        employeeId,
        status: TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
      },
      data: {
        status: TrainingProgressStatus.NOT_STARTED,
        completedAt: null,
      },
    });

    this.logger.log(`Diagnóstico del empleado ${employee.name} (${employeeId}) reiniciado por supervisor ${supervisorId}`);

    return {
      success: true,
      message: 'Diagnóstico reiniciado exitosamente',
    };
  }


  // ==========================================================================
  // Spec 016 - Pipeline de Audio: Guion, Sintesis TTS y Streaming
  // ==========================================================================

  async generatePillAudioScript(supervisorId: string, pillId: string): Promise<AudioScriptDto> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });

    if (!pill) {
      throw new NotFoundException('Pildora ' + pillId + ' no encontrada');
    }

    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    const generatedScript = await this.generator.generateAudioScript({
      title: pill.title,
      objective: pill.objective,
      content: pill.content,
    });

    await this.prisma.pill.update({
      where: { id: pillId },
      data: {
        audioScript: generatedScript as any,
        audioStatus: AudioStatus.SCRIPT_GENERATED,
        audioError: null,
      },
    });

    this.logger.log('Guion de audio generado para pildora ' + pillId + ' por supervisor ' + supervisorId);
    return generatedScript;
  }

  async updatePillAudioScript(
    supervisorId: string,
    pillId: string,
    dto: UpdateAudioScriptDto,
  ): Promise<AudioScriptDto> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });

    if (!pill) {
      throw new NotFoundException('Pildora ' + pillId + ' no encontrada');
    }

    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    if (!dto.dialogue || dto.dialogue.length === 0) {
      throw new BadRequestException('El guion debe contener al menos una linea de dialogo');
    }

    const estimatedDurationSeconds = dto.estimatedDurationSeconds || 90;

    const updatedScript: AudioScriptDto = {
      title: dto.title || pill.title,
      estimatedDurationSeconds,
      dialogue: dto.dialogue,
    };

    await this.prisma.pill.update({
      where: { id: pillId },
      data: {
        audioScript: updatedScript as any,
        audioStatus: AudioStatus.SCRIPT_GENERATED,
        audioError: null,
      },
    });

    this.logger.log('Guion de audio actualizado para pildora ' + pillId + ' por supervisor ' + supervisorId);
    return updatedScript;
  }

  async getPillAudioScript(pillId: string): Promise<AudioScriptDto> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      select: { audioScript: true, title: true },
    });

    if (!pill) {
      throw new NotFoundException('Pildora ' + pillId + ' no encontrada');
    }

    if (!pill.audioScript) {
      throw new NotFoundException('La pildora ' + pillId + ' no posee un guion de audio generado');
    }

    return pill.audioScript as unknown as AudioScriptDto;
  }

  async enqueueAudioGeneration(
    supervisorId: string,
    pillId: string,
  ): Promise<AudioStatusResponseDto> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });

    if (!pill) {
      throw new NotFoundException('Pildora ' + pillId + ' no encontrada');
    }

    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    if (!pill.audioScript) {
      throw new BadRequestException('Debe generar o cargar un guion antes de iniciar la sintesis de audio');
    }

    if (
      pill.audioStatus === AudioStatus.AUDIO_PENDING ||
      pill.audioStatus === AudioStatus.AUDIO_GENERATING
    ) {
      throw new BadRequestException('La sintesis de audio para esta pildora ya se encuentra en proceso');
    }

    await this.prisma.pill.update({
      where: { id: pillId },
      data: {
        audioStatus: AudioStatus.AUDIO_PENDING,
        audioError: null,
      },
    });

    await this.audioQueue.add(
      'generate-audio',
      { pillId },
      {
        jobId: 'audio-' + pillId + '-' + Date.now(),
      },
    );

    this.logger.log('Sintesis de audio encolada para pildora ' + pillId + ' por supervisor ' + supervisorId);

    return {
      pillId: pill.id,
      status: AudioStatus.AUDIO_PENDING,
      hasScript: true,
      hasAudio: false,
      durationSeconds: pill.audioDurationSeconds,
      error: null,
      streamUrl: '/training/pills/' + pill.id + '/audio',
    };
  }

  async getAudioStatus(pillId: string): Promise<AudioStatusResponseDto> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      select: {
        id: true,
        audioStatus: true,
        audioScript: true,
        audioDurationSeconds: true,
        audioError: true,
      },
    });

    if (!pill) {
      throw new NotFoundException('Pildora ' + pillId + ' no encontrada');
    }

    return {
      pillId: pill.id,
      status: pill.audioStatus,
      hasScript: !!pill.audioScript,
      hasAudio: pill.audioStatus === AudioStatus.AUDIO_READY,
      durationSeconds: pill.audioDurationSeconds,
      error: pill.audioError,
      streamUrl: pill.audioStatus === AudioStatus.AUDIO_READY ? ('/training/pills/' + pill.id + '/audio') : null,
    };
  }

  async getAudioStream(pillId: string, rangeHeader?: string): Promise<AudioStreamResult> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      select: { id: true, audioStatus: true },
    });

    if (!pill) {
      throw new NotFoundException('Pildora ' + pillId + ' no encontrada');
    }

    if (pill.audioStatus !== AudioStatus.AUDIO_READY) {
      throw new NotFoundException('El archivo de audio no se encuentra listo para reproduccion');
    }

    return this.audioStorageService.createAudioStream(pillId, rangeHeader);
  }

  async recordPlaybackProgress(
    employeeId: string,
    pillId: string,
    dto: ReportPlaybackProgressDto,
  ): Promise<PlaybackProgressResponseDto> {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      select: { id: true, audioDurationSeconds: true, audioStatus: true },
    });

    if (!pill) {
      throw new NotFoundException('Pildora ' + pillId + ' no encontrada');
    }

    const totalDurationSeconds = pill.audioDurationSeconds || 90;
    const now = new Date();

    const currentProgress = await this.prisma.employeeProgress.findUnique({
      where: { employeeId_pillId: { employeeId, pillId } },
    });

    const previousProgressSeconds = currentProgress?.playbackProgressSeconds || 0;
    const lastReportAt = currentProgress?.lastPlaybackReportAt;

    let computedSeconds = dto.currentSeconds;

    if (lastReportAt) {
      const elapsedRealSeconds = Math.max(0, Math.floor((now.getTime() - new Date(lastReportAt).getTime()) / 1000));
      const maxAllowedJump = previousProgressSeconds + elapsedRealSeconds + 5;

      if (dto.currentSeconds > maxAllowedJump) {
        this.logger.warn(
          'Salto sospechoso en reproduccion detectado para empleado ' + employeeId + ' en pildora ' + pillId + ': reporto ' + dto.currentSeconds + 's vs max permitido ' + maxAllowedJump + 's',
        );
        computedSeconds = Math.min(dto.currentSeconds, maxAllowedJump);
      }
    }

    const newProgressSeconds = Math.min(
      totalDurationSeconds,
      Math.max(previousProgressSeconds, computedSeconds),
    );

    const required80Seconds = Math.floor(totalDurationSeconds * 0.8);
    const hasCompleted80 = newProgressSeconds >= required80Seconds;
    const isAudioCompleted = (currentProgress?.isAudioCompleted || hasCompleted80);

    await this.prisma.employeeProgress.upsert({
      where: { employeeId_pillId: { employeeId, pillId } },
      create: {
        employeeId,
        pillId,
        playbackProgressSeconds: newProgressSeconds,
        isAudioCompleted,
        lastPlaybackReportAt: now,
        status: isAudioCompleted && currentProgress?.status === TrainingProgressStatus.NOT_STARTED
          ? TrainingProgressStatus.IN_PROGRESS
          : TrainingProgressStatus.NOT_STARTED,
      },
      update: {
        playbackProgressSeconds: newProgressSeconds,
        isAudioCompleted,
        lastPlaybackReportAt: now,
        status: isAudioCompleted && currentProgress?.status === TrainingProgressStatus.NOT_STARTED
          ? TrainingProgressStatus.IN_PROGRESS
          : undefined,
      },
    });

    const percentage = Number(((newProgressSeconds / totalDurationSeconds) * 100).toFixed(2));
    const message = isAudioCompleted
      ? 'Audio completado exitosamente (umbral 80% alcanzado).'
      : 'Progreso de reproduccion registrado correctamente.';

    return {
      pillId,
      playbackProgressSeconds: newProgressSeconds,
      totalDurationSeconds,
      percentage,
      isAudioCompleted,
      message,
    };
  }
}
