import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
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
  ) {}

  /**
   * Inicia una nueva sesión de simulación para un empleado en una píldora dada.
   */
  async startSimulation(employeeId: string, pillId: string, dto: StartSimulationDto) {
    const pill = await this.prisma.pill.findUnique({
      where: { id: pillId },
      select: { id: true, title: true, objective: true, content: true },
    });
    if (!pill) {
      throw new NotFoundException('Píldora formativa no encontrada');
    }

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
  async sendMessage(employeeId: string, sessionId: string, dto: SendSimulationMessageDto) {
    const session = await this.prisma.simulationSession.findUnique({
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
      throw new ForbiddenException('No tienes acceso a esta sesión de simulación');
    }
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
      latestEmployeeMessage: dto.content,
      pendingGoals: pendingGoals.map((g) => ({ id: g.id, description: g.description })),
    });

    // 2. Persistir ambos mensajes y actualizar objetivos cumplidos en transacción
    return this.prisma.$transaction(async (tx) => {
      // Guardar mensaje del empleado
      const empMsg = await tx.simulationMessage.create({
        data: {
          sessionId,
          sender: SimulationSender.EMPLOYEE,
          content: dto.content,
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
          if (evalItem.isCompleted) {
            await tx.simulationGoal.update({
              where: { id: evalItem.goalId },
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
          completedGoalIds: newlyCompletedGoalIds.length > 0 ? newlyCompletedGoalIds : undefined,
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
    if (session.employeeId !== userId && !isSupervisor) {
      throw new ForbiddenException('No tienes permisos para consultar esta sesión');
    }

    return session;
  }

  /**
   * Concluye la simulación y genera la devolución en 3 tarjetas cualitativas.
   */
  async concludeSimulation(employeeId: string, sessionId: string) {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: {
        pill: { select: { title: true, objective: true } },
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

    const employeeMessages = session.messages.filter((m) => m.sender === SimulationSender.EMPLOYEE);
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
      conversationTranscript: session.messages.map((m) => ({
        sender: m.sender,
        content: m.content,
      })),
    });

    return this.prisma.$transaction(async (tx) => {
      const feedback = await tx.simulationFeedback.create({
        data: {
          sessionId,
          band: feedbackData.band,
          whatWentWell: feedbackData.whatWentWell,
          toImprove: feedbackData.toImprove,
          businessRules: feedbackData.businessRules,
          summary: feedbackData.summary,
        },
      });

      await tx.simulationSession.update({
        where: { id: sessionId },
        data: {
          status: SimulationStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      return feedback;
    });
  }

  /**
   * Obtiene el listado de simulaciones de un empleado para auditoría del supervisor.
   */
  async getEmployeeSimulations(employeeId: string) {
    const sessions = await this.prisma.simulationSession.findMany({
      where: { employeeId },
      include: {
        pill: { select: { id: true, title: true } },
        feedback: { select: { band: true, summary: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((s) => ({
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
