import { TrainingController } from './training.controller';

describe('TrainingController', () => {
  let controller: TrainingController;
  let mockTrainingService: any;

  beforeEach(() => {
    mockTrainingService = {
      getEmployeeModules: jest.fn().mockResolvedValue([]),
      getEmployeePill: jest.fn().mockResolvedValue({ id: 'pill-1', title: 'Test' }),
      verifyQuiz: jest.fn().mockResolvedValue({ passed: true, explanations: [] }),
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
});
