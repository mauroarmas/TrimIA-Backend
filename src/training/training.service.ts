import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Audience,
  AudioStatus,
  PillStatus,
  Prisma,
  TrainingProgressStatus,
  SimulationMode,
  SimulationStatus,
  PerformanceBand,
  EmployeeRole,
} from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { validateAudioScript } from './audio-script-validation';
import {
  AudioStorageService,
  AudioStreamResult,
} from './services/audio-storage.service';
import { AudioScriptDto, UpdateAudioScriptDto } from './dto/audio-script.dto';
import { AudioStatusResponseDto } from './dto/audio-status.dto';
import {
  PlaybackProgressResponseDto,
  ReportPlaybackProgressDto,
} from './dto/playback-progress.dto';
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
import { pillQuizSchema, validatePillContent } from './pill-validation';
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

  private async auditPill(
    tx: Prisma.TransactionClient,
    pill: any,
    actorId: string,
    action: string,
  ) {
    await tx.pillAudit.create({
      data: {
        pillId: pill.id,
        actorId,
        action,
        version: pill.version,
        snapshot: {
          title: pill.title,
          objective: pill.objective,
          content: pill.content,
          quiz: pill.quiz,
          status: pill.status,
        },
      },
    });
  }

  async getAccessiblePill(employeeId: string, pillId: string, review = false) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, sectorId: true, role: true, isActive: true },
    });
    if (!employee || employee.isActive === false)
      throw new ForbiddenException('Empleado no habilitado');
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });
    if (
      !pill ||
      pill.status === PillStatus.ARCHIVED ||
      pill.module.isActive === false
    )
      throw new NotFoundException('Píldora no disponible');
    const supervisor = employee.role === 'SUPERVISOR';
    if (pill.status !== PillStatus.PUBLISHED) {
      if (!review || !supervisor)
        throw new NotFoundException('Píldora no disponible');
      await this.knowledge.assertPuedeEscribir(
        employeeId,
        pill.module.sector?.agentType ?? null,
      );
    }
    if (
      !supervisor &&
      pill.module.sectorId &&
      pill.module.sectorId !== employee.sectorId
    )
      throw new ForbiddenException(
        'No tiene acceso a capacitaciones de este sector',
      );
    const currentProgress = await this.prisma.employeeProgress.findUnique({
      where: { employeeId_pillId: { employeeId, pillId } },
    });
    const approved =
      currentProgress?.status === TrainingProgressStatus.COMPLETED ||
      currentProgress?.status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC;
    if (!supervisor && !approved && pill.orderIndex > 0) {
      const previous = await this.prisma.pill.findMany({
        where: {
          moduleId: pill.moduleId,
          status: PillStatus.PUBLISHED,
          orderIndex: { lt: pill.orderIndex },
        },
        select: { id: true },
      });
      if (previous.length) {
        const progress = await this.prisma.employeeProgress.findMany({
          where: {
            employeeId,
            pillId: { in: previous.map((p) => p.id) },
            status: {
              in: [
                TrainingProgressStatus.COMPLETED,
                TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
              ],
            },
          },
          select: { pillId: true },
        });
        if (progress.length < previous.length)
          throw new ForbiddenException(
            'La píldora está bloqueada. Debe completar las lecciones previas pendientes.',
          );
      }
    }
    return { pill, employee, currentProgress };
  }

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
      if (!sector)
        throw new NotFoundException(`Sector ${dto.sectorId} no encontrado`);
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
      throw new NotFoundException(
        `Módulo de capacitación ${dto.moduleId} no encontrado`,
      );
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
    validatePillContent(proposal);
    const pill = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pill.create({
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
      await this.auditPill(tx, created, supervisorId, 'CREATED');
      return created;
    });

    this.logger.log(
      `Píldora "${pill.title}" generada en DRAFT para módulo ${module.title} por supervisor ${supervisorId}`,
    );
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
      throw new BadRequestException(
        'Solo se pueden editar píldoras en estado DRAFT',
      );
    }

    // Validación de sector
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    const validated = validatePillContent({
      title: dto.title ?? pill.title,
      objective: dto.objective ?? pill.objective,
      content: dto.content ?? pill.content,
      quiz: dto.quiz ?? pill.quiz,
    });
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pill.update({
        where: { id: pillId, status: PillStatus.DRAFT },
        data: {
          ...validated,
          quiz: validated.quiz as any,
          orderIndex: dto.orderIndex ?? pill.orderIndex,
          version: { increment: 1 },
        },
        include: { module: { include: { sector: true } } },
      });
      await this.auditPill(tx, updated, supervisorId, 'EDITED');
      return updated;
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
      throw new BadRequestException(
        'Solo se pueden publicar píldoras en estado DRAFT',
      );
    }

    // Validación de sector
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );

    validatePillContent(pill);
    const publishedPill = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pill.update({
        where: { id: pillId, status: PillStatus.DRAFT },
        data: {
          status: PillStatus.PUBLISHED,
          publishedById: supervisorId,
          publishedAt: new Date(),
          version: { increment: 1 },
        },
        include: { module: { include: { sector: true } } },
      });
      await this.auditPill(tx, updated, supervisorId, 'PUBLISHED');
      return updated;
    });
    let indexing: {
      status: 'NOT_REQUESTED' | 'INDEXED' | 'DUPLICATE' | 'FAILED';
      documentId?: string;
      similarDocuments?: unknown[];
      message?: string;
      existing?: unknown;
    } = { status: 'NOT_REQUESTED' };
    if (dto.indexInKnowledge) {
      try {
        const result = await this.knowledge.ingest({
          title: 'Capacitación: ' + pill.title,
          content: pill.objective + '\n\n' + pill.content,
          category: 'CAPACITACION',
          audience: Audience.INTERNO,
          agentType: pill.module.sector?.agentType ?? null,
          sourceId: pill.id,
        });
        indexing = {
          status: 'INDEXED',
          documentId: result.documentId,
          similarDocuments: result.similarDocuments ?? [],
        };
      } catch (error) {
        const response =
          typeof error.getResponse === 'function' ? error.getResponse() : null;
        indexing =
          response?.reason === 'DUPLICATE_DOCUMENT'
            ? {
                status: 'DUPLICATE',
                existing: response.existing,
                message:
                  'La píldora se publicó; el contenido ya existe en la base de conocimiento.',
              }
            : {
                status: 'FAILED',
                message:
                  'La píldora se publicó, pero no pudo incorporarse a la base de conocimiento. Puede cargarla o reindexarla desde Conocimiento.',
              };
        this.logger.warn(
          'Publicación conservada; indexación de capacitación: ' +
            indexing.status,
        );
      }
    }
    return { ...publishedPill, indexing };
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

    const archived = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pill.update({
        where: { id: pillId },
        data: {
          status: PillStatus.ARCHIVED,
          version: { increment: 1 },
          audioGenerationId: null,
          audioStatus: AudioStatus.NOT_REQUESTED,
          audioUrl: null,
          audioDurationSeconds: null,
        },
      });
      await this.auditPill(tx, updated, supervisorId, 'ARCHIVED');
      return updated;
    });
    await this.audioStorageService.deleteAudio(pillId);
    return archived;
  }

  /**
   * Reordena las píldoras de un módulo formativo (supervisor).
   * Reordenar no le quita avance a nadie: los registros de progreso se conservan intactos.
   */
  async reorderModulePills(
    supervisorId: string,
    moduleId: string,
    pillIds: string[],
  ) {
    const mod = await this.prisma.trainingModule.findUnique({
      where: { id: moduleId },
      include: { sector: true },
    });
    if (!mod) throw new NotFoundException('Módulo no encontrado');

    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      mod.sector?.agentType ?? null,
    );

    const modulePills = await this.prisma.pill.findMany({
      where: { moduleId },
      select: { id: true },
    });
    if (
      !Array.isArray(pillIds) ||
      !pillIds.length ||
      new Set(pillIds).size !== pillIds.length ||
      pillIds.length !== modulePills.length ||
      modulePills.some((p) => !pillIds.includes(p.id))
    )
      throw new BadRequestException(
        'El orden debe incluir una vez cada píldora del módulo, sin píldoras ajenas.',
      );
    await this.prisma.$transaction(
      pillIds.map((id, index) =>
        this.prisma.pill.update({
          where: { id },
          data: { orderIndex: index },
        }),
      ),
    );

    return { success: true, count: pillIds.length };
  }

  /**
   * Lista los módulos y píldoras publicados para un empleado con candados dinámicos (US3).
   */
  async getEmployeeModules(
    employeeId: string,
  ): Promise<EmployeeModuleSummaryDto[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { sectorId: true, role: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    const isSupervisor = employee.role === 'SUPERVISOR';
    const whereClause: any = { isActive: true };
    if (!isSupervisor) {
      whereClause.OR = [{ sectorId: employee.sectorId }, { sectorId: null }];
    }

    const modules = await this.prisma.trainingModule.findMany({
      where: whereClause,
      orderBy: { orderIndex: 'asc' },
      include: {
        sector: true,
        pills: {
          where: { status: PillStatus.PUBLISHED },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    const progressRecords = await this.prisma.employeeProgress.findMany({
      where: { employeeId },
      select: {
        pillId: true,
        status: true,
        isAudioCompleted: true,
        playbackProgressSeconds: true,
      },
    });
    const progressMap = new Map(
      progressRecords.map((pr) => [pr.pillId, pr.status]),
    );
    const audioProgressMap = new Map(
      progressRecords.map((record) => [record.pillId, record]),
    );
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
      let allPreviousApproved = true; // Si el supervisor reordena, el bloqueo se calcula solo sobre lo pendiente

      const pillsSummary: EmployeePillSummaryDto[] = mod.pills.map((p) => {
        const isApproved = approvedSet.has(p.id);
        const status =
          progressMap.get(p.id) ?? TrainingProgressStatus.NOT_STARTED;
        // Una píldora ya completada/eximida NUNCA se bloquea al reordenar
        const isLocked = isSupervisor
          ? false
          : isApproved
            ? false
            : !allPreviousApproved;
        if (!isApproved) {
          allPreviousApproved = false;
        }

        return {
          id: p.id,
          title: p.title,
          objective: p.objective,
          orderIndex: p.orderIndex,
          isCompleted: isApproved,
          isExempted: status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
          status,
          isLocked,
          audioStatus: p.audioStatus,
          hasAudio: p.audioStatus === AudioStatus.AUDIO_READY,
          audioDurationSeconds: p.audioDurationSeconds,
          isAudioCompleted:
            audioProgressMap.get(p.id)?.isAudioCompleted ?? false,
          playbackProgressSeconds:
            audioProgressMap.get(p.id)?.playbackProgressSeconds ?? 0,
        };
      });

      return {
        id: mod.id,
        title: mod.title,
        description: mod.description,
        sectorId: mod.sectorId,
        sectorName: mod.sector?.name ?? null,
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
  async getEmployeePill(
    employeeId: string,
    pillId: string,
  ): Promise<EmployeePillDetailDto> {
    const { pill, currentProgress } = await this.getAccessiblePill(
      employeeId,
      pillId,
    );

    const quizRaw = this.extractQuizQuestions(pill.quiz);
    const safeQuiz = quizRaw.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
    }));

    const isExempted =
      currentProgress?.status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC;
    const isCompleted =
      currentProgress?.status === TrainingProgressStatus.COMPLETED ||
      isExempted;

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
      streamUrl:
        pill.audioStatus === AudioStatus.AUDIO_READY
          ? '/training/pills/' + pill.id + '/audio'
          : null,
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
    const { pill } = await this.getAccessiblePill(employeeId, pillId);
    const parsedQuiz = pillQuizSchema.safeParse(
      this.extractQuizQuestions(pill.quiz),
    );
    if (!parsedQuiz.success)
      throw new BadRequestException(
        'El cuestionario de esta píldora necesita revisión del supervisor.',
      );
    const quiz = parsedQuiz.data;
    if (
      !Array.isArray(answers) ||
      answers.length !== quiz.length ||
      answers.some(
        (answer, i) =>
          !Number.isInteger(answer) ||
          answer < 0 ||
          answer >= quiz[i].options.length,
      )
    ) {
      throw new BadRequestException(
        'Responda las dos preguntas con una de las opciones disponibles.',
      );
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
          status:
            existingProgress?.status === TrainingProgressStatus.COMPLETED
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
  private safeDiagnosticQuestions(questions: any[]): DiagnosticQuestionDto[] {
    return questions.map((q) => ({
      moduleId: q.moduleId,
      moduleTitle: q.moduleTitle,
      pillId: q.pillId,
      pillTitle: q.pillTitle,
      questionId: q.questionId,
      question: q.question,
      options: q.options,
    }));
  }

  async getDiagnosticQuestions(
    employeeId: string,
  ): Promise<DiagnosticQuizResponseDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, sectorId: true, isActive: true },
    });
    if (!employee || employee.isActive === false)
      throw new NotFoundException('Empleado no habilitado');
    const existing = await this.prisma.diagnosticSession.findFirst({
      where: { employeeId, isReset: false },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.completedAt)
      throw new BadRequestException(
        'El empleado ya ha completado su evaluación diagnóstica inicial',
      );
    if (existing?.questionSet) {
      const questions = this.safeDiagnosticQuestions(
        existing.questionSet as any[],
      );
      return {
        totalQuestions: questions.length,
        estimatedMinutes: 5,
        questions,
      };
    }
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
    const groups = modules
      .map((module) =>
        module.pills.flatMap((pill) =>
          this.extractQuizQuestions(pill.quiz).map((q) => ({
            moduleId: module.id,
            moduleTitle: module.title,
            sectorId: module.sectorId,
            pillId: pill.id,
            pillTitle: pill.title,
            questionId: q.id,
            question: q.question,
            options: q.options,
            correctOptionIndex: q.correctOptionIndex,
          })),
        ),
      )
      .filter((group) => group.length);
    const selected: any[] = [];
    for (
      let round = 0;
      selected.length < 8 && groups.some((group) => group[round]);
      round++
    ) {
      for (const group of groups)
        if (group[round] && selected.length < 8) selected.push(group[round]);
    }
    if (!selected.length)
      return { totalQuestions: 0, estimatedMinutes: 5, questions: [] };
    try {
      await this.prisma.diagnosticSession.create({
        data: {
          employeeId,
          activeKey: employeeId,
          questionSet: selected,
          totalQuestions: selected.length,
          correctAnswers: 0,
          score: 0,
          answers: [],
          exemptedModuleIds: [],
          completedAt: null,
        },
      });
    } catch (error) {
      if (error.code === 'P2002')
        return this.getDiagnosticQuestions(employeeId);
      throw error;
    }
    return {
      totalQuestions: selected.length,
      estimatedMinutes: 5,
      questions: this.safeDiagnosticQuestions(selected),
    };
  }

  async submitDiagnostic(
    employeeId: string,
    dto: SubmitDiagnosticDto,
  ): Promise<DiagnosticResultDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, sectorId: true, isActive: true },
    });
    if (!employee || employee.isActive === false)
      throw new NotFoundException('Empleado no habilitado');
    const session = await this.prisma.diagnosticSession.findFirst({
      where: { employeeId, isReset: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!session?.questionSet)
      throw new BadRequestException(
        'Inicie el diagnóstico antes de enviar las respuestas.',
      );
    if (session.completedAt)
      throw new BadRequestException(
        'El empleado ya ha completado su evaluación diagnóstica inicial',
      );
    const questions = session.questionSet as any[];
    const keyOf = (q: { pillId: string; questionId: number }) =>
      q.pillId + ':' + q.questionId;
    const questionMap = new Map(questions.map((q) => [keyOf(q), q]));
    if (
      !Array.isArray(dto.answers) ||
      dto.answers.length !== questions.length ||
      new Set(dto.answers.map(keyOf)).size !== questions.length
    )
      throw new BadRequestException(
        'Debe responder todas las preguntas del diagnóstico una sola vez.',
      );
    const evaluated = dto.answers.map((answer) => {
      const q = questionMap.get(keyOf(answer));
      if (
        !q ||
        (q.sectorId && q.sectorId !== employee.sectorId) ||
        !Number.isInteger(answer.selectedOptionIndex) ||
        answer.selectedOptionIndex < 0 ||
        answer.selectedOptionIndex >= q.options.length
      )
        throw new BadRequestException(
          'La respuesta no pertenece al diagnóstico asignado o no es una opción válida.',
        );
      return {
        ...answer,
        moduleId: q.moduleId,
        isCorrect: answer.selectedOptionIndex === q.correctOptionIndex,
      };
    });
    const moduleIds = [...new Set(questions.map((q) => q.moduleId as string))];
    const exemptedModules: { id: string; title: string }[] = [];
    const pendingModules: { id: string; title: string }[] = [];
    for (const id of moduleIds) {
      const answers = evaluated.filter((answer) => answer.moduleId === id);
      const module = {
        id,
        title: questions.find((q) => q.moduleId === id).moduleTitle,
      };
      (answers.every((answer) => answer.isCorrect)
        ? exemptedModules
        : pendingModules
      ).push(module);
    }
    const correctAnswers = evaluated.filter(
      (answer) => answer.isCorrect,
    ).length;
    const score = Math.round((correctAnswers / questions.length) * 1000) / 10;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.diagnosticSession.updateMany({
        where: {
          id: session.id,
          employeeId,
          isReset: false,
          completedAt: null,
        },
        data: {
          completedAt: new Date(),
          score,
          correctAnswers,
          totalQuestions: questions.length,
          answers: evaluated,
          exemptedModuleIds: exemptedModules.map((module) => module.id),
        },
      });
      if (claimed.count !== 1)
        throw new BadRequestException(
          'El diagnóstico ya fue completado o reiniciado.',
        );
      for (const module of exemptedModules) {
        const pills = await tx.pill.findMany({
          where: {
            moduleId: module.id,
            status: PillStatus.PUBLISHED,
            module: { isActive: true },
          },
          select: { id: true },
        });
        for (const pill of pills) {
          const previous = await tx.employeeProgress.findUnique({
            where: { employeeId_pillId: { employeeId, pillId: pill.id } },
          });
          if (previous?.status === TrainingProgressStatus.COMPLETED) continue;
          await tx.employeeProgress.upsert({
            where: { employeeId_pillId: { employeeId, pillId: pill.id } },
            create: {
              employeeId,
              pillId: pill.id,
              status: TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
              completedAt: new Date(),
            },
            update: {
              status: TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
              completedAt: new Date(),
            },
          });
        }
      }
    });
    return {
      sessionId: session.id,
      score,
      totalQuestions: questions.length,
      correctAnswers,
      exemptedModules,
      pendingModules,
      message:
        'Diagnóstico completado. Tu ruta de aprendizaje está actualizada.',
    };
  }

  async getSupervisorEmployeeDiagnostic(
    supervisorId: string,
    employeeId: string,
  ): Promise<SupervisorDiagnosticDetailResponseDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { sector: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      employee.sector?.agentType ?? null,
    );
    const latestSession = await this.prisma.diagnosticSession.findFirst({
      where: { employeeId, completedAt: { not: null } },
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
            answers: (Array.isArray(latestSession.answers)
              ? (latestSession.answers as any[])
              : []
            ).map((answer) => {
              const question = (
                latestSession.questionSet as any[] | null
              )?.find(
                (q) =>
                  q.pillId === answer.pillId &&
                  q.questionId === answer.questionId,
              );
              return {
                ...answer,
                question: question?.question,
                options: question?.options,
              };
            }),
          }
        : null,
    };
  }

  async resetEmployeeDiagnostic(supervisorId: string, employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { sector: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      employee.sector?.agentType ?? null,
    );
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.diagnosticSession.updateMany({
        where: { employeeId, isReset: false },
        data: {
          isReset: true,
          resetById: supervisorId,
          resetAt: new Date(),
          activeKey: null,
        },
      });
      if (!updated.count)
        throw new NotFoundException(
          'El empleado no posee un diagnóstico activo para reiniciar',
        );
      await tx.employeeProgress.updateMany({
        where: {
          employeeId,
          status: TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC,
        },
        data: { status: TrainingProgressStatus.NOT_STARTED, completedAt: null },
      });
    });
    return { success: true, message: 'Diagnóstico reiniciado exitosamente' };
  }

  async getSupervisorTracking(supervisorId: string) {
    const supervisor = await this.prisma.employee.findUnique({
      where: { id: supervisorId },
      select: { role: true },
    });
    if (supervisor?.role !== 'SUPERVISOR') {
      throw new ForbiddenException(
        'Solo los supervisores pueden consultar el seguimiento de ingresantes',
      );
    }

    // 1. Obtener todos los colaboradores no supervisores
    const employees = await this.prisma.employee.findMany({
      where: {
        role: { not: EmployeeRole.SUPERVISOR },
        isActive: true,
      },
      include: {
        sector: true,
      },
      orderBy: { name: 'asc' },
    });

    // 2. Obtener todas las píldoras publicadas agrupadas por sector y transversales
    const publishedPills = await this.prisma.pill.findMany({
      where: { status: PillStatus.PUBLISHED },
      include: { module: true },
      orderBy: [{ module: { orderIndex: 'asc' } }, { orderIndex: 'asc' }],
    });

    // 3. Obtener el progreso de todos los empleados
    const allProgress = await this.prisma.employeeProgress.findMany({});
    const progressByEmployee = new Map<string, typeof allProgress>();
    for (const pr of allProgress) {
      if (!progressByEmployee.has(pr.employeeId)) {
        progressByEmployee.set(pr.employeeId, []);
      }
      progressByEmployee.get(pr.employeeId)!.push(pr);
    }

    // 4. Obtener las sesiones de simulación libres concluidas
    const freeSimulations = await this.prisma.simulationSession.findMany({
      where: {
        mode: SimulationMode.FREE,
        status: SimulationStatus.COMPLETED,
      },
      select: {
        employeeId: true,
        feedback: {
          select: { band: true },
        },
        completedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const freeSimsByEmployee = new Map<string, typeof freeSimulations>();
    for (const s of freeSimulations) {
      if (!freeSimsByEmployee.has(s.employeeId)) {
        freeSimsByEmployee.set(s.employeeId, []);
      }
      freeSimsByEmployee.get(s.employeeId)!.push(s);
    }

    // 5. Mapear cada empleado y calcular sus métricas
    const now = new Date();
    const trackingList = employees.map((emp) => {
      // Píldoras relevantes para este empleado (su sector o transversal general)
      const relevantPills = publishedPills.filter(
        (p) => !p.module.sectorId || p.module.sectorId === emp.sectorId,
      );
      const totalPills = relevantPills.length;

      const empProg = progressByEmployee.get(emp.id) || [];
      const completedPillsCount = relevantPills.filter((p) =>
        empProg.some(
          (pr) =>
            pr.pillId === p.id &&
            (pr.status === TrainingProgressStatus.COMPLETED ||
              pr.status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC),
        ),
      ).length;

      const percentage =
        totalPills > 0
          ? Math.round((completedPillsCount / totalPills) * 100)
          : 0;

      // Parada actual: primera píldora no completada
      const nextPendingPill = relevantPills.find(
        (p) =>
          !empProg.some(
            (pr) =>
              pr.pillId === p.id &&
              (pr.status === TrainingProgressStatus.COMPLETED ||
                pr.status === TrainingProgressStatus.EXEMPTED_BY_DIAGNOSTIC),
          ),
      );

      const currentParada = nextPendingPill
        ? `${nextPendingPill.title}`
        : totalPills > 0
          ? 'Ruta completada'
          : 'Sin paradas asignadas';

      // Simulaciones libres
      const empSims = freeSimsByEmployee.get(emp.id) || [];
      const failedFreeSimulationsCount = empSims.filter(
        (s) => s.feedback?.band === PerformanceBand.NOT_ACHIEVED,
      ).length;

      // Última actividad
      const lastProgDate = empProg.reduce<Date | null>((max, p) => {
        const d = p.updatedAt ? new Date(p.updatedAt) : null;
        if (!d) return max;
        return !max || d > max ? d : max;
      }, null);

      const lastSimDate =
        empSims[0]?.completedAt || empSims[0]?.createdAt || null;
      const dates = [
        lastProgDate,
        lastSimDate ? new Date(lastSimDate) : null,
      ].filter(Boolean) as Date[];
      const lastActivity =
        dates.length > 0
          ? new Date(Math.max(...dates.map((d) => d.getTime())))
          : null;

      const daysWithoutProgress = lastActivity
        ? Math.floor(
            (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24),
          )
        : null;

      // Estado según requerimiento:
      // "Necesita ayuda" si: lleva más de 3 días sin avance, o desaprobó 2 veces la simulación libre.
      let trackingStatus: 'IN_TRAINING' | 'NEEDS_HELP' | 'READY' =
        'IN_TRAINING';
      let trackingStatusLabel = 'En capacitación';

      if (percentage === 100 && failedFreeSimulationsCount === 0) {
        trackingStatus = 'READY';
        trackingStatusLabel = 'Listo para atender';
      } else if (
        (daysWithoutProgress !== null && daysWithoutProgress >= 3) ||
        failedFreeSimulationsCount >= 2
      ) {
        trackingStatus = 'NEEDS_HELP';
        trackingStatusLabel = 'Necesita ayuda';
      } else {
        trackingStatus = 'IN_TRAINING';
        trackingStatusLabel = 'En capacitación';
      }

      return {
        id: emp.id,
        name: emp.name,
        email: emp.email || emp.phone || '',
        role: emp.sector?.name
          ? `Asesor/a comercial (${emp.sector.name})`
          : 'Ingresante comercial',
        sectorId: emp.sectorId,
        sectorName: emp.sector?.name || 'General / Transversal',
        currentParada,
        completedPills: completedPillsCount,
        totalPills,
        percentage,
        lastActivity: lastActivity ? lastActivity.toISOString() : null,
        daysWithoutProgress,
        failedFreeSimulationsCount,
        trackingStatus,
        trackingStatusLabel,
      };
    });

    const summary = {
      inTraining: trackingList.filter((t) => t.trackingStatus === 'IN_TRAINING')
        .length,
      needsHelp: trackingList.filter((t) => t.trackingStatus === 'NEEDS_HELP')
        .length,
      readyToServe: trackingList.filter((t) => t.trackingStatus === 'READY')
        .length,
      total: trackingList.length,
    };

    return {
      summary,
      employees: trackingList,
    };
  }

  // ==========================================================================
  // Spec 016 - Pipeline de Audio: Guion, Sintesis TTS y Streaming
  // ==========================================================================

  private async supervisorAudioPill(supervisorId: string, pillId: string) {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      include: { module: { include: { sector: true } } },
    });
    if (!pill) throw new NotFoundException('Píldora no encontrada');
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      pill.module.sector?.agentType ?? null,
    );
    if (pill.status !== PillStatus.PUBLISHED || pill.module.isActive === false)
      throw new BadRequestException(
        'El audio se prepara para una píldora publicada y activa.',
      );
    if (
      pill.audioStatus === AudioStatus.AUDIO_PENDING ||
      pill.audioStatus === AudioStatus.AUDIO_GENERATING
    )
      throw new ConflictException(
        'Ya hay una generación en proceso. Esperá que termine antes de editar o reintentar.',
      );
    return pill;
  }

  private async persistAudioScript(pillId: string, script: AudioScriptDto) {
    const valid = validateAudioScript(script);
    const changed = await this.prisma.pill.updateMany({
      where: {
        id: pillId,
        status: PillStatus.PUBLISHED,
        audioStatus: {
          notIn: [AudioStatus.AUDIO_PENDING, AudioStatus.AUDIO_GENERATING],
        },
      },
      data: {
        audioScript: valid as any,
        audioStatus: AudioStatus.SCRIPT_GENERATED,
        audioError: null,
        audioGenerationId: null,
      },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        'La píldora cambió o su audio está en proceso. Volvé a cargarla.',
      );
    return valid;
  }

  async generatePillAudioScript(
    supervisorId: string,
    pillId: string,
    targetDurationSeconds?: number,
  ): Promise<AudioScriptDto> {
    const pill = await this.supervisorAudioPill(supervisorId, pillId);
    if (
      targetDurationSeconds !== undefined &&
      (!Number.isInteger(targetDurationSeconds) ||
        targetDurationSeconds < 30 ||
        targetDurationSeconds > 300)
    )
      throw new BadRequestException(
        'La duración objetivo debe estar entre 30 y 300 segundos.',
      );
    const script = await this.generator.generateAudioScript({
      title: pill.title,
      objective: pill.objective,
      content: pill.content,
      sectorId: pill.module.sectorId,
      targetDurationSeconds,
    });
    return this.persistAudioScript(pillId, script);
  }

  async updatePillAudioScript(
    supervisorId: string,
    pillId: string,
    dto: UpdateAudioScriptDto,
  ): Promise<AudioScriptDto> {
    const pill = await this.supervisorAudioPill(supervisorId, pillId);
    const words =
      dto.dialogue?.reduce(
        (total, line) =>
          total + (line.text || '').trim().split(/\s+/).filter(Boolean).length,
        0,
      ) ?? 0;
    return this.persistAudioScript(pillId, {
      title: dto.title ?? pill.title,
      estimatedDurationSeconds:
        dto.estimatedDurationSeconds ??
        Math.max(1, Math.ceil((words / 140) * 60)),
      dialogue: dto.dialogue,
    });
  }

  async getPillAudioScript(
    employeeId: string,
    pillId: string,
  ): Promise<AudioScriptDto> {
    const { pill } = await this.getAccessiblePill(employeeId, pillId, true);
    if (!pill.audioScript)
      throw new NotFoundException(
        'La píldora todavía no tiene guion de audio.',
      );
    return pill.audioScript as unknown as AudioScriptDto;
  }

  async enqueueAudioGeneration(
    supervisorId: string,
    pillId: string,
  ): Promise<AudioStatusResponseDto> {
    const pill = await this.supervisorAudioPill(supervisorId, pillId);
    validateAudioScript(pill.audioScript as unknown as AudioScriptDto);
    const generationId = randomUUID();
    const claimed = await this.prisma.pill.updateMany({
      where: {
        id: pillId,
        status: PillStatus.PUBLISHED,
        audioStatus: {
          notIn: [AudioStatus.AUDIO_PENDING, AudioStatus.AUDIO_GENERATING],
        },
      },
      data: {
        audioStatus: AudioStatus.AUDIO_PENDING,
        audioError: null,
        audioGenerationId: generationId,
      },
    });
    if (claimed.count !== 1)
      throw new ConflictException(
        'Ya hay una generación en proceso para esta píldora.',
      );
    try {
      await this.audioQueue.add(
        'generate-audio',
        { pillId, generationId },
        { jobId: 'audio-' + pillId + '-' + generationId },
      );
    } catch {
      await this.prisma.pill.updateMany({
        where: {
          id: pillId,
          audioGenerationId: generationId,
          audioStatus: AudioStatus.AUDIO_PENDING,
        },
        data: {
          audioStatus: AudioStatus.AUDIO_FAILED,
          audioError:
            'No se pudo encolar el audio. El guion se conserva; puede reintentarse.',
        },
      });
      throw new ServiceUnavailableException(
        'No se pudo iniciar la generación. Podés reintentar sin perder el guion.',
      );
    }
    return {
      pillId,
      status: AudioStatus.AUDIO_PENDING,
      hasScript: true,
      hasAudio: false,
      durationSeconds: pill.audioDurationSeconds,
      error: null,
      streamUrl: null,
    };
  }

  async getAudioStatus(
    employeeId: string,
    pillId: string,
  ): Promise<AudioStatusResponseDto> {
    const { pill } = await this.getAccessiblePill(employeeId, pillId, true);
    return {
      pillId,
      status: pill.audioStatus,
      hasScript: !!pill.audioScript,
      hasAudio: pill.audioStatus === AudioStatus.AUDIO_READY,
      durationSeconds: pill.audioDurationSeconds,
      error: pill.audioError,
      streamUrl:
        pill.audioStatus === AudioStatus.AUDIO_READY
          ? '/training/pills/' + pillId + '/audio'
          : null,
    };
  }

  async getAudioStream(
    employeeId: string,
    pillId: string,
    rangeHeader?: string,
  ): Promise<AudioStreamResult> {
    const { pill } = await this.getAccessiblePill(employeeId, pillId, true);
    if (pill.audioStatus !== AudioStatus.AUDIO_READY)
      throw new NotFoundException('El audio todavía no está disponible.');
    return this.audioStorageService.createAudioStream(pillId, rangeHeader);
  }

  async recordPlaybackProgress(
    employeeId: string,
    pillId: string,
    dto: ReportPlaybackProgressDto,
  ): Promise<PlaybackProgressResponseDto> {
    const { pill } = await this.getAccessiblePill(employeeId, pillId);
    const totalDurationSeconds = pill.audioDurationSeconds;
    if (
      pill.audioStatus !== AudioStatus.AUDIO_READY ||
      !totalDurationSeconds ||
      !Number.isInteger(dto.currentSeconds) ||
      dto.currentSeconds < 0 ||
      dto.currentSeconds > totalDurationSeconds
    )
      throw new BadRequestException(
        'El audio debe estar disponible y el avance debe pertenecer a su duración real.',
      );
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const current = await tx.employeeProgress.upsert({
        where: { employeeId_pillId: { employeeId, pillId } },
        create: {
          employeeId,
          pillId,
          status: TrainingProgressStatus.IN_PROGRESS,
          playbackProgressSeconds: 0,
          isAudioCompleted: false,
          lastPlaybackReportAt: now,
        },
        update: {},
      });
      const previous = current.playbackProgressSeconds;
      const delta = Math.max(0, dto.currentSeconds - previous);
      const anchor = Math.max(
        current.lastPlaybackReportAt?.getTime() ?? now.getTime(),
        now.getTime() - 30000,
      );
      const allowed = Math.max(0, Math.floor((now.getTime() - anchor) / 1000));
      if (delta > allowed)
        throw new BadRequestException(
          'El salto no corresponde al tiempo de escucha. Retomá desde el último avance registrado.',
        );
      const playbackProgressSeconds = Math.max(previous, dto.currentSeconds);
      const isAudioCompleted =
        current.isAudioCompleted ||
        playbackProgressSeconds >= Math.ceil(totalDurationSeconds * 0.8);
      const updated = await tx.employeeProgress.updateMany({
        where: {
          id: current.id,
          playbackProgressSeconds: previous,
          lastPlaybackReportAt: current.lastPlaybackReportAt,
        },
        data: {
          playbackProgressSeconds,
          isAudioCompleted,
          lastPlaybackReportAt: delta ? new Date(anchor + delta * 1000) : now,
          status:
            current.status === TrainingProgressStatus.NOT_STARTED
              ? TrainingProgressStatus.IN_PROGRESS
              : current.status,
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          'El avance cambió en otra reproducción. Volvé a cargar la píldora.',
        );
      return {
        pillId,
        playbackProgressSeconds,
        totalDurationSeconds,
        percentage: Number(
          ((playbackProgressSeconds / totalDurationSeconds) * 100).toFixed(2),
        ),
        isAudioCompleted,
        message: isAudioCompleted
          ? 'Audio completado (80% de escucha).'
          : 'Avance de escucha guardado.',
      };
    });
  }

  async answerPillDoubt(
    employeeId: string,
    pillId: string,
    question?: string,
  ): Promise<{ text: string; source: string }> {
    const cleanQuestion = (question ?? '').trim();
    if (!cleanQuestion) {
      throw new BadRequestException('Ingresá una pregunta para consultar a Trimi.');
    }

    const { pill } = await this.getAccessiblePill(employeeId, pillId);
    const agentType = pill.module.sector?.agentType ?? undefined;

    return this.generator.answerLessonDoubt({
      question: cleanQuestion,
      pillTitle: pill.title,
      pillObjective: pill.objective,
      pillContent: pill.content,
      audioScript: pill.audioScript as any,
      agentType,
    });
  }
}
