import { TrainingController } from './training.controller';

describe('TrainingController', () => {
  let controller: TrainingController;
  let mockTrainingService: any;

  beforeEach(() => {
    mockTrainingService = {
      getEmployeeModules: jest.fn().mockResolvedValue([]),
      getEmployeePill: jest.fn().mockResolvedValue({ id: 'pill-1', title: 'Test' }),
      verifyQuiz: jest.fn().mockResolvedValue({ passed: true, explanations: [] }),
      getDiagnosticQuestions: jest.fn().mockResolvedValue({
        totalQuestions: 6,
        estimatedMinutes: 5,
        questions: [],
      }),
      submitDiagnostic: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        score: 100,
        exemptedModules: [{ id: 'mod-1', title: 'M1' }],
      }),
    };

    controller = new TrainingController(mockTrainingService);
  });

  it('debe listar módulos para el empleado autenticado', async () => {
    const req = { user: { id: 'emp-1' } };
    await controller.getMyModules(req);

    expect(mockTrainingService.getEmployeeModules).toHaveBeenCalledWith('emp-1');
  });

  it('debe obtener el detalle de la píldora para el empleado autenticado', async () => {
    const req = { user: { id: 'emp-1' } };
    await controller.getPill(req, 'pill-1');

    expect(mockTrainingService.getEmployeePill).toHaveBeenCalledWith('emp-1', 'pill-1');
  });

  it('debe enviar verificación de respuestas al quiz', async () => {
    const req = { user: { id: 'emp-1' } };
    await controller.verifyQuiz(req, 'pill-1', { answers: [0, 1] });

    expect(mockTrainingService.verifyQuiz).toHaveBeenCalledWith('emp-1', 'pill-1', [0, 1]);
  });

  it('debe solicitar el cuestionario diagnóstico para el empleado (US1)', async () => {
    const req = { user: { id: 'emp-1' } };
    const res = await controller.getDiagnostic(req);

    expect(mockTrainingService.getDiagnosticQuestions).toHaveBeenCalledWith('emp-1');
    expect(res.totalQuestions).toBe(6);
  });

  it('debe enviar respuestas al diagnóstico inicial (US2)', async () => {
    const req = { user: { id: 'emp-1' } };
    const dto = {
      answers: [
        { pillId: 'pill-1', questionId: 1, selectedOptionIndex: 0 },
      ],
    };
    const res = await controller.submitDiagnostic(req, dto);

    expect(mockTrainingService.submitDiagnostic).toHaveBeenCalledWith('emp-1', dto);
    expect(res.score).toBe(100);
  });
});
