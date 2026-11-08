import { AdministrativeCreditService } from './administrative-credit.service';
import { createEvaluateCreditTool } from './tools/evaluate-credit.tool';

describe('Crédito: frontera administrativa antes del contexto generativo', () => {
  let port: any;
  let db: any;
  let service: AdministrativeCreditService;
  beforeEach(() => {
    port = {
      evaluateCredit: jest.fn(async () => ({
        verdict: 'APPROVED_WITH_CONDITIONS',
        score: 640,
        reason: 'Deuda BCRA confidencial',
        rawReport: { debt: 120000 },
        commercialCondition: 'Anticipo 20%',
        assessedAt: new Date(),
      })),
    };
    db = {
      employee: {
        findUnique: jest.fn(async () => ({
          isActive: true,
          role: 'EMPLEADO',
          sector: { agentType: 'SALES' },
          areasSupervisadas: [],
        })),
      },
      sector: { count: jest.fn(async () => 5) },
    };
    service = new AdministrativeCreditService(port, db);
  });
  it.each([undefined, 'sales-employee'])(
    'solo entrega dictamen comercial a %s',
    async (id) => {
      const result = await service.forCaller({ dni: '32123456' }, id);
      expect(result).not.toHaveProperty('score');
      expect(JSON.stringify(result)).not.toMatch(/BCRA|debt|120000/);
    },
  );
  it('el detalle depende del empleado activo de Administración, nunca del nombre del agente', async () => {
    db.employee.findUnique.mockResolvedValue({
      isActive: true,
      role: 'EMPLEADO',
      sector: { agentType: 'ADMIN' },
      areasSupervisadas: [],
    });
    expect(
      await service.forCaller({ dni: '32123456' }, 'admin-id'),
    ).toHaveProperty('score', 640);
    db.employee.findUnique.mockResolvedValue({
      isActive: false,
      role: 'SUPERVISOR',
      sector: { agentType: 'ADMIN' },
      areasSupervisadas: [],
    });
    expect(
      await service.forCaller({ dni: '32123456' }, 'inactive'),
    ).not.toHaveProperty('score');
  });
  it('la tool ignora un employeeId propuesto por el modelo', async () => {
    const tool = createEvaluateCreditTool(service);
    const result = JSON.parse(
      String(
        await tool.invoke({ dni: '32123456', employeeId: 'admin-id' } as any),
      ),
    );
    expect(result).not.toHaveProperty('score');
    expect(db.employee.findUnique).not.toHaveBeenCalled();
  });
  it('una excepción conserva UNAVAILABLE sin filtrar el error', async () => {
    port.evaluateCredit.mockRejectedValue(
      new Error('credential provider secret'),
    );
    const result = await service.commercial({ dni: '32123456' });
    expect(result.verdict).toBe('UNAVAILABLE');
    expect(JSON.stringify(result)).not.toMatch(/secret|credential|score/);
  });
});
