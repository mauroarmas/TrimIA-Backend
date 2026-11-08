import { ServiceUnavailableException } from '@nestjs/common';
import { SimulationAiService } from './simulation-ai.service';

describe('IA de simulación sin evaluación inventada', () => {
  const invoke = jest.fn();
  const structured = jest.fn(() => ({ invoke }));
  const service = new SimulationAiService({
    chat: { withStructuredOutput: structured },
  } as any);
  beforeEach(() => jest.clearAllMocks());
  it('informa indisponibilidad de escenario en vez de imponer un préstamo a Depósito', async () => {
    invoke.mockRejectedValue(new Error('Proveedor caído'));
    await expect(
      service.generateScenario({
        title: 'Recepción',
        objective: 'Recibir',
        content: 'Contar cajas',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
  it('no fabrica feedback cuando el proveedor falla', async () => {
    invoke.mockRejectedValue(new Error('Proveedor caído'));
    await expect(
      service.generateFeedback({
        scenarioTitle: 'Depósito',
        customerProfile: 'Consulta entrega',
        pillObjective: 'Recibir',
        pillContent: 'Contar cajas',
        sector: 'Depósito',
        conversationTranscript: [],
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
  it('envía procedimiento y transcripción y exige las tres bandas', async () => {
    invoke.mockResolvedValue({
      band: 'ACHIEVED',
      whatWentWellBand: 'ACHIEVED',
      toImproveBand: 'NEEDS_IMPROVEMENT',
      businessRulesBand: 'ACHIEVED',
      whatWentWell: 'Contó las cajas',
      toImprove: 'Repasar',
      businessRules: 'Siguió el conteo',
      summary: 'Logrado',
    });
    const result = await service.generateFeedback({
      scenarioTitle: 'Depósito',
      customerProfile: 'Entrega',
      pillObjective: 'Recibir',
      pillContent: 'Contar cajas',
      sector: 'Depósito',
      conversationTranscript: [
        { sender: 'EMPLOYEE', content: 'Conté las cajas' },
      ],
    });
    expect(String(invoke.mock.calls[0][0][1].content)).toContain(
      'Contar cajas',
    );
    expect(String(invoke.mock.calls[0][0][1].content)).toContain(
      'Conté las cajas',
    );
    expect(result.businessRulesBand).toBe('ACHIEVED');
    invoke.mockResolvedValue({ ...result, businessRulesBand: undefined });
    await expect(
      service.generateFeedback({
        scenarioTitle: 'Depósito',
        customerProfile: 'Entrega',
        pillObjective: 'Recibir',
        pillContent: 'Contar cajas',
        sector: 'Depósito',
        conversationTranscript: [],
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
