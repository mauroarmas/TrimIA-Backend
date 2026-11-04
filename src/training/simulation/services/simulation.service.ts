import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { TrainingService } from '../../training.service';
import { KnowledgeService } from '../../../ai/knowledge/knowledge.service';
import { PrismaService } from '../../../database/prisma.service';
import { SimulationAiService } from './simulation-ai.service';
import { StartSimulationDto } from '../dto/start-simulation.dto';
import { SendSimulationMessageDto } from '../dto/send-simulation-message.dto';
import {
  SimulationMode,
  SimulationStatus,
  SimulationSender,
} from '@prisma/client';

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationAi: SimulationAiService,
    private readonly training: TrainingService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /**
   * Inicia una nueva sesión de simulación para un empleado en una píldora dada.
   */
  async startSimulation(
    employeeId: string,
    pillId: string,
    dto: StartSimulationDto,
  ) {
    const { pill } = await this.training.getAccessiblePill(employeeId, pillId);

    // 1. Generar escenario y objetivos mediante IA
    const scenario = await this.simulationAi.generateScenario({
      title: pill.title,
      objective: pill.objective,
      content: pill.content,
    });

    // 2. Crear sesión, primer mensaje del cliente y objetivos en una transacción
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.simulationSession.create({
        data: {
          employeeId,
          pillId,
          mode: dto.mode,
          status: SimulationStatus.IN_PROGRESS,
          scenarioTitle: scenario.scenarioTitle,
          customerName: scenario.customerName,
          customerProfile: scenario.customerProfile,
        },
      });

      // Primer mensaje del cliente simulado saludando
      const initialMessage = await tx.simulationMessage.create({
        data: {
          sessionId: session.id,
          sender: SimulationSender.SIMULATED_CLIENT,
          content: scenario.initialCustomerGreeting,
          turnIndex: 0,
          emotion: 'neutral',
        },
      });

      // Objetivos del checklist pedagógico (solo si es modo guiado)
      let goals = [];
      if (dto.mode === SimulationMode.GUIDED && scenario.goals.length > 0) {
        goals = await Promise.all(
          scenario.goals.map((g, idx) =>
            tx.simulationGoal.create({
              data: {
                sessionId: session.id,
                description: g.description,
                order: idx,
                isCompleted: false,
              },
            }),
          ),
        );
      }

      return {
        ...session,
        messages: [initialMessage],
        goals,
        feedback: null,
      };
    });
  }

  /**
   * Envía un mensaje como empleado y genera la respuesta del cliente simulado (con evaluación en vivo en modo guiado).
   */
  async sendMessage(
    employeeId: string,
    sessionId: string,
    dto: SendSimulationMessageDto,
  ) {
    const content = dto.content?.trim();
    if (!content || content.length < 2)
      throw new BadRequestException(
        'El mensaje debe tener al menos 2 caracteres.',
      );
    let session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: {
        goals: { orderBy: { order: 'asc' } },
        messages: { orderBy: { turnIndex: 'asc' } },
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión de simulación no encontrada');
    }
    if (session.employeeId !== employeeId) {
      throw new ForbiddenException(
        'No tienes acceso a esta sesión de simulación',
      );
    }
    session = await this.expireSession(session);
    if (session.status !== SimulationStatus.IN_PROGRESS) {
      throw new BadRequestException('La sesión de simulación ya fue concluida');
    }

    const currentTurn = session.messages.length;
    const pendingGoals = session.goals.filter((g) => !g.isCompleted);

    // 1. Invocar a la IA para obtener la réplica del cliente y la evaluación
    const aiResponse = await this.simulationAi.generateTurnResponse({
      mode: session.mode,
      customerName: session.customerName,
      customerProfile: session.customerProfile,
      conversationHistory: session.messages.map((m) => ({
        sender: m.sender,
        content: m.content,
      })),
      latestEmployeeMessage: content,
      pendingGoals: pendingGoals.map((g) => ({
        id: g.id,
        description: g.description,
      })),
    });

    // 2. Persistir ambos mensajes y actualizar objetivos cumplidos en transacción
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.simulationSession.updateMany({
        where: {
          id: sessionId,
          employeeId,
          status: SimulationStatus.IN_PROGRESS,
          version: session.version,
        },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          'La sesión cambió mientras respondía. Volvé a cargarla.',
        );
      // Guardar mensaje del empleado
      const empMsg = await tx.simulationMessage.create({
        data: {
          sessionId,
          sender: SimulationSender.EMPLOYEE,
          content,
          turnIndex: currentTurn,
        },
      });

      // Actualizar objetivos en modo guiado
      const newlyCompletedGoalIds: string[] = [];
      if (
        session.mode === SimulationMode.GUIDED &&
        aiResponse.completedGoalEvaluations &&
        aiResponse.completedGoalEvaluations.length > 0
      ) {
        for (const evalItem of aiResponse.completedGoalEvaluations) {
          if (
            evalItem.isCompleted &&
            pendingGoals.some((goal) => goal.id === evalItem.goalId) &&
            evalItem.evidence?.trim() &&
            content.includes(evalItem.evidence.trim()) &&
            !newlyCompletedGoalIds.includes(evalItem.goalId)
          ) {
            await tx.simulationGoal.updateMany({
              where: { id: evalItem.goalId, sessionId, isCompleted: false },
              data: {
                isCompleted: true,
                completedAtTurn: currentTurn,
                evidence: evalItem.evidence || undefined,
              },
            });
            newlyCompletedGoalIds.push(evalItem.goalId);
          }
        }
      }

      // Guardar mensaje del cliente simulado
      const clientMsg = await tx.simulationMessage.create({
        data: {
          sessionId,
          sender: SimulationSender.SIMULATED_CLIENT,
          content: aiResponse.customerResponse,
          turnIndex: currentTurn + 1,
          emotion: aiResponse.emotion,
          completedGoalIds:
            newlyCompletedGoalIds.length > 0
              ? newlyCompletedGoalIds
              : undefined,
        },
      });

      // Consultar lista actualizada de objetivos
      const updatedGoals = await tx.simulationGoal.findMany({
        where: { sessionId },
        orderBy: { order: 'asc' },
      });

      const allGoalsCompleted =
        updatedGoals.length > 0 && updatedGoals.every((g) => g.isCompleted);

      return {
        employeeMessage: empMsg,
        clientMessage: clientMsg,
        updatedGoals,
        allGoalsCompleted,
      };
    });
  }

  /**
   * Consulta el detalle y mensajes de una sesión.
   */
  async getSession(userId: string, sessionId: string, isSupervisor = false) {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: {
        goals: { orderBy: { order: 'asc' } },
        messages: { orderBy: { turnIndex: 'asc' } },
        feedback: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión de simulación no encontrada');
    }
    if (session.employeeId !== userId) {
      if (!isSupervisor)
        throw new ForbiddenException(
          'No tienes permisos para consultar esta sesión',
        );
      await this.assertSupervisor(userId, session.employeeId);
    }
    return this.expireSession(session);
  }

  /**
   * Concluye la simulación y genera la devolución en 3 tarjetas cualitativas.
   */
  async concludeSimulation(employeeId: string, sessionId: string) {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: {
        pill: { include: { module: { include: { sector: true } } } },
        messages: { orderBy: { turnIndex: 'asc' } },
        feedback: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Sesión de simulación no encontrada');
    }
    if (session.employeeId !== employeeId) {
      throw new ForbiddenException('No tienes acceso a esta sesión');
    }
    if (session.status === SimulationStatus.COMPLETED && session.feedback) {
      return session.feedback;
    }

    const current = await this.expireSession(session);
    if (current.status !== SimulationStatus.IN_PROGRESS)
      throw new BadRequestException(
        'Esta práctica ya no está activa. Iniciá otra.',
      );
    const employeeMessages = session.messages.filter(
      (m) => m.sender === SimulationSender.EMPLOYEE,
    );
    if (employeeMessages.length < 2) {
      throw new BadRequestException(
        'Debes intercambiar al menos 2 mensajes con el cliente simulado antes de finalizar la práctica',
      );
    }

    // Generar las 3 tarjetas cualitativas
    const feedbackData = await this.simulationAi.generateFeedback({
      scenarioTitle: session.scenarioTitle,
      customerProfile: session.customerProfile,
      pillObjective: session.pill.objective,
      pillContent: session.pill.content,
      sector: session.pill.module.sector?.name ?? 'General',
      conversationTranscript: session.messages.map((m) => ({
        sender: m.sender,
        content: m.content,
      })),
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.simulationSession.updateMany({
          where: {
            id: sessionId,
            employeeId,
            status: SimulationStatus.IN_PROGRESS,
            version: session.version,
          },
          data: {
            status: SimulationStatus.COMPLETED,
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            'La sesión cambió durante la evaluación. Volvé a intentarlo.',
          );
        return tx.simulationFeedback.create({
          data: { sessionId, ...feedbackData },
        });
      });
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const latest = await this.prisma.simulationSession.findUnique({
        where: { id: sessionId },
        include: { feedback: true },
      });
      if (latest?.status === SimulationStatus.COMPLETED && latest.feedback)
        return latest.feedback;
      throw error;
    }
  }

  private async assertSupervisor(supervisorId: string, employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { sector: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');
    await this.knowledge.assertPuedeEscribir(
      supervisorId,
      employee.sector?.agentType ?? null,
    );
  }

  private async expireSession<
    T extends {
      id: string;
      status: SimulationStatus;
      version: number;
      createdAt: Date;
      messages: { createdAt: Date }[];
    },
  >(session: T): Promise<T> {
    const last = session.messages.at(-1)?.createdAt ?? session.createdAt;
    if (
      session.status === SimulationStatus.IN_PROGRESS &&
      Date.now() - last.getTime() >= 24 * 3600000
    ) {
      const updated = await this.prisma.simulationSession.updateMany({
        where: {
          id: session.id,
          status: SimulationStatus.IN_PROGRESS,
          version: session.version,
        },
        data: { status: SimulationStatus.ABANDONED, version: { increment: 1 } },
      });
      if (updated.count === 1)
        return { ...session, status: SimulationStatus.ABANDONED };
      throw new ConflictException('La sesión cambió. Volvé a cargarla.');
    }
    return session;
  }

  async getActiveSession(
    employeeId: string,
    pillId: string,
    mode: SimulationMode,
  ) {
    await this.training.getAccessiblePill(employeeId, pillId);
    if (!Object.values(SimulationMode).includes(mode))
      throw new BadRequestException('Modo de práctica inválido');
    const sessions = await this.prisma.simulationSession.findMany({
      where: { employeeId, pillId, mode, status: SimulationStatus.IN_PROGRESS },
      include: {
        messages: { orderBy: { turnIndex: 'asc' } },
        goals: { orderBy: { order: 'asc' } },
        feedback: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    let active = null;
    for (const session of sessions) {
      const current = await this.expireSession(session);
      if (!active && current.status === SimulationStatus.IN_PROGRESS)
        active = current;
    }
    return active;
  }

  /**
   * Obtiene el listado de simulaciones de un empleado para auditoría del supervisor.
   */
  async getEmployeeSimulations(supervisorId: string, employeeId: string) {
    await this.assertSupervisor(supervisorId, employeeId);
    const sessions = await this.prisma.simulationSession.findMany({
      where: { employeeId },
      include: {
        pill: { select: { id: true, title: true } },
        feedback: { select: { band: true, summary: true, createdAt: true } },
        messages: { orderBy: { turnIndex: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    const current = await Promise.all(
      sessions.map((s) => this.expireSession(s)),
    );
    return current.map((s) => ({
      id: s.id,
      pillId: s.pillId,
      pillTitle: s.pill.title,
      mode: s.mode,
      status: s.status,
      scenarioTitle: s.scenarioTitle,
      customerName: s.customerName,
      band: s.feedback?.band ?? null,
      summary: s.feedback?.summary ?? null,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
    }));
  }
}
