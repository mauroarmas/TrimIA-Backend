import { BadRequestException } from '@nestjs/common';
import { TrainingGeneratorService } from './training-generator.service';

describe('Generación de píldoras: respaldo y estructura', () => {
  const quiz = [1, 2].map((id) => ({
    id,
    question: 'Pregunta ' + id,
    options: ['Primera', 'Segunda', 'Tercera'],
    correctOptionIndex: 0,
    explanation: 'Primera por el procedimiento.',
  }));
  const proposal = {
    title: 'Recibir comprobantes',
    objective: 'Recibir comprobantes legibles',
    steps: [1, 2, 3].map((stepNumber) => ({
      stepNumber,
      title: 'Paso ' + stepNumber,
      instruction: 'Revisar el comprobante según el procedimiento.',
    })),
    quiz,
  };
  let invoke: jest.Mock;
  let search: jest.Mock;
  let service: TrainingGeneratorService;

  beforeEach(() => {
    invoke = jest.fn().mockResolvedValue(proposal);
    search = jest.fn().mockResolvedValue([
      {
        title: 'Comprobantes',
        content: 'Revisar monto y legibilidad del comprobante.',
        score: 0.85,
      },
    ]);
    service = new TrainingGeneratorService(
      {
        sector: {
          findUnique: jest.fn().mockResolvedValue({ agentType: 'COLLECTIONS' }),
        },
        interviewQuestion: { findMany: jest.fn().mockResolvedValue([]) },
      } as any,
      { chat: { withStructuredOutput: () => ({ invoke }) } } as any,
      { search } as any,
      { get: () => 0.5 } as any,
    );
  });

  it('busca en el sector y no usa hits irrelevantes como respaldo', async () => {
    search.mockResolvedValue([
      { title: 'Otra cosa', content: 'No corresponde al tema', score: 0.1 },
    ]);
    await expect(
      service.generatePillProposal('Comprobantes', 'collections'),
    ).rejects.toThrow(BadRequestException);
    expect(search).toHaveBeenCalledWith(
      'Comprobantes',
      expect.objectContaining({ agentType: 'COLLECTIONS' }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reintenta una estructura inválida y solo entrega un borrador válido', async () => {
    invoke.mockResolvedValueOnce({
      ...proposal,
      steps: proposal.steps.slice(0, 2),
    });
    const result = await service.generatePillProposal(
      'Comprobantes',
      'collections',
    );
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.content).toContain('Paso 3');
  });

  it('no entrega opciones correctas fuera de las alternativas', async () => {
    invoke.mockResolvedValue({
      ...proposal,
      quiz: [{ ...quiz[0], correctOptionIndex: 3 }, quiz[1]],
    });
    await expect(
      service.generatePillProposal('Comprobantes', 'collections'),
    ).rejects.toThrow(BadRequestException);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
