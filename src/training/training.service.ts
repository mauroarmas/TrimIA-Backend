import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Audience, PillStatus, TrainingProgressStatus } from '@prisma/client';
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

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly generator: TrainingGeneratorService,
  ) {}

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
    const completedSet = new Set(
      progressRecords
        .filter((pr) => pr.status === TrainingProgressStatus.COMPLETED)
        .map((pr) => pr.pillId),
    );

    return modules.map((mod) => {
      let previousPillCompleted = true; // La primera píldora siempre arranca desbloqueada

      const pillsSummary: EmployeePillSummaryDto[] = mod.pills.map((p, idx) => {
        const isCompleted = completedSet.has(p.id);
        const isLocked = idx === 0 ? false : !previousPillCompleted;
        previousPillCompleted = isCompleted;

        return {
          id: p.id,
          title: p.title,
          objective: p.objective,
          orderIndex: p.orderIndex,
          isCompleted,
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

        if (prevProgress?.status !== TrainingProgressStatus.COMPLETED) {
          throw new ForbiddenException('La píldora está bloqueada. Debe completar la lección previa.');
        }
      }
    }

    const currentProgress = await this.prisma.employeeProgress.findUnique({
      where: { employeeId_pillId: { employeeId, pillId } },
    });

    const quizRaw = (pill.quiz as unknown as VerificationQuestion[]) || [];
    const safeQuiz = quizRaw.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
    }));

    return {
      id: pill.id,
      moduleId: pill.moduleId,
      title: pill.title,
      objective: pill.objective,
      content: pill.content,
      orderIndex: pill.orderIndex,
      isCompleted: currentProgress?.status === TrainingProgressStatus.COMPLETED,
      isLocked: false,
      quiz: safeQuiz,
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

    const quiz = (pill.quiz as unknown as VerificationQuestion[]) || [];
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
}
