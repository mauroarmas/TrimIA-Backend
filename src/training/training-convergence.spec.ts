import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TrainingService } from './training.service';
import { validatePillContent } from './pill-validation';

export const validQuiz = [
  {
    id: 1,
    question: '¿Qué revisar?',
    options: ['Monto', 'Color', 'Tamaño'],
    correctOptionIndex: 0,
    explanation: 'Revisar el monto informado.',
  },
  {
    id: 2,
    question: '¿Quién confirma?',
    options: ['Bot', 'Responsable', 'Cliente'],
    correctOptionIndex: 1,
    explanation: 'Confirma el responsable autorizado.',
  },
];
const content =
  '### Paso 1: Recibir\n\nRecibir el comprobante.\n\n### Paso 2: Revisar\n\nRevisar el monto.\n\n### Paso 3: Derivar\n\nDerivar al responsable.';

describe('Capacitación: contratos y accesos de convergencia', () => {
  let prisma: any;
  let knowledge: any;
  let service: TrainingService;
  let pill: any;

  beforeEach(() => {
    pill = {
      id: 'pill',
      moduleId: 'module',
      title: 'Comprobantes',
      objective: 'Recibir comprobantes',
      content,
      quiz: validQuiz,
      status: 'PUBLISHED',
      orderIndex: 0,
      version: 1,
      module: {
        id: 'module',
        isActive: true,
        sectorId: 'collections',
        sector: { agentType: 'COLLECTIONS' },
      },
    };
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'employee',
          sectorId: 'collections',
          role: 'EMPLEADO',
          isActive: true,
        }),
      },
      pill: {
        findUnique: jest.fn().mockImplementation(async () => pill),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...pill,
          ...data,
          version: 2,
        })),
      },
      pillAudit: { create: jest.fn().mockResolvedValue({}) },
      employeeProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    knowledge = {
      assertPuedeEscribir: jest.fn(),
      ingest: jest
        .fn()
        .mockResolvedValue({ documentId: 'doc', similarDocuments: [] }),
    };
    service = new TrainingService(
      prisma,
      knowledge,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it.each([
    { title: '', objective: 'Objetivo', content, quiz: validQuiz },
    { title: 'Título', objective: 'Objetivo', content, quiz: [validQuiz[0]] },
    {
      title: 'Título',
      objective: 'Objetivo',
      content,
      quiz: [{ ...validQuiz[0], options: ['una', 'dos'] }, validQuiz[1]],
    },
    {
      title: 'Título',
      objective: 'Objetivo',
      content,
      quiz: [{ ...validQuiz[0], correctOptionIndex: 3 }, validQuiz[1]],
    },
  ])('rechaza una píldora inválida antes de publicar: %#', (data) => {
    expect(() => validatePillContent(data)).toThrow(BadRequestException);
  });

  it('no revela explicaciones ni escribe progreso de otro sector', async () => {
    pill.module.sectorId = 'sales';
    await expect(
      service.verifyQuiz('employee', 'pill', [0, 1]),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.employeeProgress.upsert).not.toHaveBeenCalled();
  });

  it('no completa por URL directa una lección bloqueada', async () => {
    pill.orderIndex = 1;
    prisma.pill.findFirst.mockResolvedValue({ id: 'previous' });
    await expect(
      service.verifyQuiz('employee', 'pill', [0, 1]),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.employeeProgress.upsert).not.toHaveBeenCalled();
  });

  it('rechaza respuestas extra y fuera de las opciones', async () => {
    await expect(
      service.verifyQuiz('employee', 'pill', [0, 1, 0]),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.verifyQuiz('employee', 'pill', [99, 0]),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.employeeProgress.upsert).not.toHaveBeenCalled();
  });

  it('conserva publicación válida y comunica la falla de indexación', async () => {
    pill.status = 'DRAFT';
    knowledge.ingest.mockRejectedValue(new Error('Índice no disponible'));
    const result = await service.publishPill('supervisor', 'pill', {
      indexInKnowledge: true,
    });
    expect(result.status).toBe('PUBLISHED');
    expect(result.indexing.status).toBe('FAILED');
    expect(prisma.pillAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'supervisor',
          action: 'PUBLISHED',
          version: 2,
        }),
      }),
    );
  });

  it('devuelve las similitudes para que las revise el supervisor', async () => {
    pill.status = 'DRAFT';
    knowledge.ingest.mockResolvedValue({
      documentId: 'doc',
      similarDocuments: [{ id: 'similar' }],
    });
    const result = await service.publishPill('supervisor', 'pill', {
      indexInKnowledge: true,
    });
    expect(result.indexing).toMatchObject({
      status: 'INDEXED',
      documentId: 'doc',
      similarDocuments: [{ id: 'similar' }],
    });
  });
});
