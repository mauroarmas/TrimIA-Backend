import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TrainingService } from './training.service';

describe('Diagnóstico: entrega vinculada y autorización', () => {
  let service: TrainingService;
  let prisma: any;
  let session: any;
  let knowledge: any;
  beforeEach(() => {
    session = {
      id: 'exam',
      employeeId: 'employee',
      activeKey: 'employee',
      isReset: false,
      completedAt: null,
      questionSet: [1, 2].map((questionId) => ({
        pillId: 'pill',
        questionId,
        moduleId: 'module',
        moduleTitle: 'Módulo',
        sectorId: 'collections',
        question: 'Pregunta',
        options: ['Una', 'Dos', 'Tres'],
        correctOptionIndex: 0,
      })),
    };
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'employee',
          name: 'Empleado',
          sectorId: 'collections',
          sector: { agentType: 'COLLECTIONS' },
        }),
      },
      diagnosticSession: {
        findFirst: jest.fn().mockImplementation(async () => session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockImplementation(async () => session),
      },
      pill: { findMany: jest.fn().mockResolvedValue([{ id: 'pill' }]) },
      employeeProgress: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    knowledge = { assertPuedeEscribir: jest.fn() };
    service = new TrainingService(
      prisma,
      knowledge,
      {} as any,
      {} as any,
      {} as any,
    );
  });
  it.each([
    { answers: [{ pillId: 'pill', questionId: 1, selectedOptionIndex: 0 }] },
    {
      answers: [
        { pillId: 'pill', questionId: 1, selectedOptionIndex: 0 },
        { pillId: 'pill', questionId: 1, selectedOptionIndex: 0 },
      ],
    },
    {
      answers: [
        { pillId: 'foreign', questionId: 1, selectedOptionIndex: 0 },
        { pillId: 'pill', questionId: 2, selectedOptionIndex: 0 },
      ],
    },
  ])(
    'no exime con entrega incompleta, duplicada o ajena: %#',
    async ({ answers }) => {
      await expect(
        service.submitDiagnostic('employee', { answers }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employeeProgress.upsert).not.toHaveBeenCalled();
    },
  );
  it('califica el examen completo e incluye una sola exención por módulo', async () => {
    const result = await service.submitDiagnostic('employee', {
      answers: [1, 2].map((questionId) => ({
        pillId: 'pill',
        questionId,
        selectedOptionIndex: 0,
      })),
    });
    expect(result.score).toBe(100);
    expect(result.exemptedModules).toEqual([{ id: 'module', title: 'Módulo' }]);
    expect(prisma.diagnosticSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ completedAt: null }),
        data: expect.objectContaining({
          correctAnswers: 2,
          completedAt: expect.any(Date),
        }),
      }),
    );
  });
  it('no ignora la denegación de sector por tratarse de un supervisor', async () => {
    knowledge.assertPuedeEscribir.mockRejectedValue(new ForbiddenException());
    await expect(
      service.getSupervisorEmployeeDiagnostic('foreign-supervisor', 'employee'),
    ).rejects.toThrow(ForbiddenException);
  });
  it('una entrega concurrente perdida no cambia progreso', async () => {
    prisma.diagnosticSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.submitDiagnostic('employee', {
        answers: [1, 2].map((questionId) => ({
          pillId: 'pill',
          questionId,
          selectedOptionIndex: 0,
        })),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.employeeProgress.upsert).not.toHaveBeenCalled();
  });
  it('rechaza una entrega de un examen que aún no se inició', async () => {
    session = null;
    await expect(
      service.submitDiagnostic('employee', {
        answers: [{ pillId: 'pill', questionId: 1, selectedOptionIndex: 0 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
