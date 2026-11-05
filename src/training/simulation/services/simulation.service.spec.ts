import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { SimulationService } from './simulation.service';

const feedback = {
  band: 'ACHIEVED',
  whatWentWellBand: 'ACHIEVED',
  toImproveBand: 'NEEDS_IMPROVEMENT',
  businessRulesBand: 'ACHIEVED',
  whatWentWell: 'Cita real',
  toImprove: 'Revisar',
  businessRules: 'Procedimiento',
  summary: 'Repasar',
};
describe('Simulación: seguridad, turnos y evaluación', () => {
  let service: SimulationService;
  let db: any;
  let ai: any;
  let training: any;
  let knowledge: any;
  let session: any;
  beforeEach(() => {
    session = {
      id: 's1',
      employeeId: 'e1',
      pillId: 'p1',
      mode: 'GUIDED',
      status: 'IN_PROGRESS',
      version: 0,
      createdAt: new Date(),
      customerName: 'Cliente',
      customerProfile: 'Consulta',
      scenarioTitle: 'Depósito',
      pill: {
        objective: 'Recibir',
        content: 'Solo revisar mercadería',
        module: { sector: { name: 'Depósito' } },
      },
      goals: [{ id: 'g1', isCompleted: false, description: 'Saludar' }],
      messages: [
        {
          turnIndex: 0,
          sender: 'SIMULATED_CLIENT',
          content: 'Hola',
          createdAt: new Date(),
        },
      ],
      feedback: null,
    };
    db = {
      simulationSession: {
        findUnique: jest.fn(async () => session),
        findMany: jest.fn(async () => [session]),
        create: jest.fn(async ({ data }) => ({ id: 's1', ...data })),
        updateMany: jest.fn(async ({ where, data }) => {
          if (
            where.version !== session.version ||
            where.status !== session.status
          )
            return { count: 0 };
          session = { ...session, ...data, version: session.version + 1 };
          return { count: 1 };
        }),
      },
      simulationMessage: { create: jest.fn(async ({ data }) => data) },
      simulationGoal: {
        create: jest.fn(async ({ data }) => data),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => session.goals),
      },
      simulationFeedback: {
        create: jest.fn(async ({ data }) => {
          session.feedback = data;
          return data;
        }),
      },
      employee: {
        findUnique: jest.fn(async () => ({
          sector: { agentType: 'DEPOSITO' },
        })),
      },
    };
    db.$transaction = jest.fn(async (fn) => fn(db));
    ai = {
      generateScenario: jest.fn(async () => ({
        scenarioTitle: 'Depósito',
        customerName: 'Cliente',
        customerProfile: 'Consulta de entrega',
        initialCustomerGreeting: 'Hola',
        goals: [{ description: 'Revisar' }],
      })),
      generateTurnResponse: jest.fn(async () => ({
        customerResponse: 'Gracias',
        emotion: 'neutral',
        completedGoalEvaluations: [
          { goalId: 'foreign', isCompleted: true, evidence: 'Hola' },
          { goalId: 'g1', isCompleted: true, evidence: 'Hola' },
        ],
      })),
      generateFeedback: jest.fn(async () => feedback),
    };
    training = {
      getAccessiblePill: jest.fn(async () => ({
        pill: { title: 'Recibir', content: 'Revisar', objective: 'Recepción' },
      })),
    };
    knowledge = { assertPuedeEscribir: jest.fn(async () => {}) };
    service = new SimulationService(db, ai, training, knowledge);
  });
  it('comprueba publicación, sector y candado antes de generar', async () => {
    training.getAccessiblePill.mockRejectedValue(new ForbiddenException());
    await expect(
      service.startSimulation('e1', 'p1', { mode: 'GUIDED' }),
    ).rejects.toThrow(ForbiddenException);
    expect(ai.generateScenario).not.toHaveBeenCalled();
  });
  it.each(['GUIDED', 'FREE'])(
    'inicia %s con mensajes propios y sin checklist en FREE',
    async (mode: any) => {
      const result = await service.startSimulation('e1', 'p1', { mode });
      expect(result.messages).toHaveLength(1);
      expect(result.goals).toHaveLength(mode === 'GUIDED' ? 1 : 0);
    },
  );
  it('deniega ajenos y comprueba el ámbito de supervisión', async () => {
    await expect(service.getSession('other', 's1')).rejects.toThrow(
      ForbiddenException,
    );
    knowledge.assertPuedeEscribir.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(service.getSession('supervisor', 's1', true)).rejects.toThrow(
      ForbiddenException,
    );
    await service.getSession('supervisor', 's1', true);
    expect(knowledge.assertPuedeEscribir).toHaveBeenCalledWith(
      'supervisor',
      'DEPOSITO',
    );
  });
  it('limita objetivos a los pendientes de esta sesión y cita observable', async () => {
    await service.sendMessage('e1', 's1', { content: 'Hola, bienvenido' });
    expect(db.simulationGoal.updateMany).toHaveBeenCalledTimes(1);
    expect(db.simulationGoal.updateMany.mock.calls[0][0].where).toEqual({
      id: 'g1',
      sessionId: 's1',
      isCompleted: false,
    });
  });
  it('rechaza espacios antes de IA y persistencia', async () => {
    await expect(
      service.sendMessage('e1', 's1', { content: '  ' }),
    ).rejects.toThrow(BadRequestException);
    expect(ai.generateTurnResponse).not.toHaveBeenCalled();
  });
  it('no guarda un turno lento si la sesión se cerró entretanto', async () => {
    ai.generateTurnResponse.mockImplementation(async () => {
      session.status = 'COMPLETED';
      return { customerResponse: 'Hola' };
    });
    await expect(
      service.sendMessage('e1', 's1', { content: 'Hola' }),
    ).rejects.toThrow(ConflictException);
    expect(db.simulationMessage.create).not.toHaveBeenCalled();
  });
  it('solo persiste uno de dos turnos concurrentes sobre la misma versión', async () => {
    const result = await Promise.allSettled([
      service.sendMessage('e1', 's1', { content: 'Hola' }),
      service.sendMessage('e1', 's1', { content: 'Hola otra vez' }),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(db.simulationMessage.create).toHaveBeenCalledTimes(2);
  });
  it('preserva sesión si falla la evaluación y le pasa el procedimiento aprobado', async () => {
    session.messages.push(
      ...[1, 2].map((n) => ({
        sender: 'EMPLOYEE',
        content: 'Revisar ' + n,
        createdAt: new Date(),
      })),
    );
    ai.generateFeedback.mockRejectedValue(new Error('Proveedor indisponible'));
    await expect(service.concludeSimulation('e1', 's1')).rejects.toThrow(
      'Proveedor indisponible',
    );
    expect(ai.generateFeedback.mock.calls[0][0].pillContent).toBe(
      'Solo revisar mercadería',
    );
    expect(db.simulationFeedback.create).not.toHaveBeenCalled();
    expect(session.status).toBe('IN_PROGRESS');
  });
  it('exige dos intercambios y devuelve el feedback existente al repetir el cierre', async () => {
    await expect(service.concludeSimulation('e1', 's1')).rejects.toThrow(
      BadRequestException,
    );
    session.messages.push(
      ...[1, 2].map((n) => ({
        sender: 'EMPLOYEE',
        content: 'Revisar ' + n,
        createdAt: new Date(),
      })),
    );
    expect(await service.concludeSimulation('e1', 's1')).toEqual(
      expect.objectContaining(feedback),
    );
    await service.concludeSimulation('e1', 's1');
    expect(ai.generateFeedback).toHaveBeenCalledTimes(1);
  });
  it('reabre la vigente con historial y abandona tras 24 horas', async () => {
    expect((await service.getActiveSession('e1', 'p1', 'GUIDED')).id).toBe(
      's1',
    );
    session.messages[0].createdAt = new Date(Date.now() - 25 * 3600000);
    expect(await service.getActiveSession('e1', 'p1', 'GUIDED')).toBeNull();
    expect(session.status).toBe('ABANDONED');
    await expect(
      service.sendMessage('e1', 's1', { content: 'Hola' }),
    ).rejects.toThrow(BadRequestException);
  });
});
