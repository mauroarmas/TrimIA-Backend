import { BadRequestException } from '@nestjs/common';
import { Audience } from '@prisma/client';
import { TrainingGeneratorService } from './training-generator.service';

describe('TrainingGeneratorService', () => {
  let service: TrainingGeneratorService;
  let mockPrisma: any;
  let mockLlm: any;
  let mockKnowledge: any;
  let mockStructuredModel: any;

  beforeEach(() => {
    mockPrisma = {
      interviewQuestion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockStructuredModel = {
      invoke: jest.fn().mockResolvedValue({
        title: 'Verificación de Comprobantes de Pago',
        objective: 'Aprender a cotejar el código de operación bancario y fecha de impacto.',
        steps: [
          { stepNumber: 1, title: 'Recepción del comprobante', instruction: 'Abrir el archivo adjunto y constatar nitidez.' },
          { stepNumber: 2, title: 'Cotejo en sistema', instruction: 'Verificar monto y cuenta destino en el panel.' },
        ],
        quiz: [
          {
            id: 1,
            question: '¿Qué se debe hacer si el comprobante es ilegible?',
            options: ['Rechazar de inmediato', 'Solicitar nuevo envío nítido al cliente', 'Aprobar por las dudas'],
            correctOptionIndex: 1,
            explanation: 'Se debe pedir una imagen nítida antes de validar.',
          },
          {
            id: 2,
            question: '¿Quién valida el impacto bancario final?',
            options: ['El bot', 'El cobrador controlador', 'Cualquier empleado'],
            correctOptionIndex: 1,
            explanation: 'Solo el cobrador controlador o supervisor valida el impacto.',
          },
        ],
      }),
    };

    mockLlm = {
      chat: {
        withStructuredOutput: jest.fn().mockReturnValue(mockStructuredModel),
      },
    };

    mockKnowledge = {
      search: jest.fn().mockResolvedValue([
        {
          id: 'doc-1',
          title: 'Procedimiento de Cobranzas',
          content: 'Detalle de validación de transferencias y comprobantes...',
          score: 0.85,
        },
      ]),
    };

    service = new TrainingGeneratorService(mockPrisma, mockLlm, mockKnowledge);
  });

  it('debe generar una píldora estructurada correctamente cuando hay contexto suficiente', async () => {
    const result = await service.generatePillProposal('Validación de comprobantes', 'sector-1', 'Dar énfasis al código de operación');

    expect(mockKnowledge.search).toHaveBeenCalledWith('Validación de comprobantes', {
      audience: Audience.INTERNO,
      k: 4,
    });
    expect(mockStructuredModel.invoke).toHaveBeenCalled();
    expect(result.title).toBe('Verificación de Comprobantes de Pago');
    expect(result.objective).toContain('Aprender a cotejar');
    expect(result.content).toContain('### Paso 1: Recepción del comprobante');
    expect(result.content).toContain('### Paso 2: Cotejo en sistema');
    expect(result.quiz).toHaveLength(2);
    expect(result.quiz[0].correctOptionIndex).toBe(1);
    expect(result.quiz[1].explanation).toBeDefined();
  });

  it('debe incorporar contexto de entrevistas previas si existen para el sector', async () => {
    mockPrisma.interviewQuestion.findMany.mockResolvedValueOnce([
      {
        text: '¿Cómo procedés si el banco no coincide?',
        answers: [{ text: 'Se pide constancia CBU adicional.' }],
      },
    ]);

    await service.generatePillProposal('Validación de comprobantes', 'sector-1');

    expect(mockPrisma.interviewQuestion.findMany).toHaveBeenCalled();
    const promptPassed = mockStructuredModel.invoke.mock.calls[0][0][1].content;
    expect(promptPassed).toContain('ENTREVISTAS PREVIAS DEL SECTOR:');
    expect(promptPassed).toContain('Se pide constancia CBU adicional');
  });

  it('debe lanzar BadRequestException si no hay documentos ni entrevistas (Principio II - Cero Alucinación)', async () => {
    mockKnowledge.search.mockResolvedValueOnce([]);
    mockPrisma.interviewQuestion.findMany.mockResolvedValueOnce([]);

    await expect(
      service.generatePillProposal('Tema desconocido inexistente', 'sector-1'),
    ).rejects.toThrow(BadRequestException);

    expect(mockStructuredModel.invoke).not.toHaveBeenCalled();
  });
});
