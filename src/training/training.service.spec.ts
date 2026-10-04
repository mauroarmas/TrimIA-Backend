import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentType, Audience, PillStatus, TrainingProgressStatus } from '@prisma/client';
import { TrainingService } from './training.service';

describe('TrainingService', () => {
  let service: TrainingService;
  let mockPrisma: any;
  let mockKnowledge: any;
  let mockGenerator: any;

  beforeEach(() => {
    mockPrisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          sectorId: 'sector-cobranzas',
        }),
      },
      employeeProgress: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'prog-1', ...create })),
      },
      trainingModule: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'mod-1',
          title: 'Procedimientos de Cobranzas',
          sectorId: 'sector-cobranzas',
          sector: { id: 'sector-cobranzas', agentType: AgentType.COLLECTIONS },
        }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mod-new', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      sector: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sector-cobranzas', agentType: AgentType.COLLECTIONS }),
      },
      pill: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pill-1', ...data })),
        findUnique: jest.fn().mockResolvedValue({
          id: 'pill-1',
          moduleId: 'mod-1',
          title: 'Píldora Inicial',
          objective: 'Objetivo de prueba',
          content: 'Pasos...',
          quiz: [
            { id: 1, question: 'P1', options: ['O1', 'O2'], correctOptionIndex: 0, explanation: 'Exp1' },
            { id: 2, question: 'P2', options: ['O1', 'O2'], correctOptionIndex: 1, explanation: 'Exp2' },
          ],
          status: PillStatus.DRAFT,
          orderIndex: 0,
          module: {
            id: 'mod-1',
            sectorId: 'sector-cobranzas',
            sector: { agentType: AgentType.COLLECTIONS },
          },
        }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pill-1', ...data })),
      },
    };

    mockKnowledge = {
      assertPuedeEscribir: jest.fn().mockResolvedValue(undefined),
      ingest: jest.fn().mockResolvedValue({ documentId: 'doc-created', chunks: 2 }),
    };

    mockGenerator = {
      generatePillProposal: jest.fn().mockResolvedValue({
        title: 'Gestión de Mora Temprana',
        objective: 'Contactar al cliente antes del vencimiento',
        content: '### Paso 1: Revisar cuota',
        quiz: [
          { id: 1, question: '¿Cuándo llamar?', options: ['3 días antes', 'El mismo día'], correctOptionIndex: 0, explanation: 'Anticipación' },
          { id: 2, question: '¿Qué pedir?', options: ['Aviso de pago', 'Comprobante'], correctOptionIndex: 1, explanation: 'Cotejo' },
        ],
      }),
    };

    service = new TrainingService(mockPrisma, mockKnowledge, mockGenerator);
  });

  describe('generatePillDraft (US1)', () => {
    it('debe generar una píldora en DRAFT y verificar permisos de sector', async () => {
      const result = await service.generatePillDraft('supervisor-1', {
        moduleId: 'mod-1',
        topic: 'Gestión de mora',
      });

      expect(mockKnowledge.assertPuedeEscribir).toHaveBeenCalledWith('supervisor-1', AgentType.COLLECTIONS);
      expect(mockGenerator.generatePillProposal).toHaveBeenCalledWith('Gestión de mora', 'sector-cobranzas', undefined);
      expect(mockPrisma.pill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PillStatus.DRAFT,
            createdById: 'supervisor-1',
            orderIndex: 0,
          }),
        }),
      );
      expect(result.status).toBe(PillStatus.DRAFT);
    });

    it('debe rechazar la generación si el supervisor no tiene permiso en el sector (Principio I)', async () => {
      mockKnowledge.assertPuedeEscribir.mockRejectedValueOnce(
        new ForbiddenException('No autorizado para modificar sector ajeno'),
      );

      await expect(
        service.generatePillDraft('supervisor-ajeno', { moduleId: 'mod-1', topic: 'Gestión de mora' }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockGenerator.generatePillProposal).not.toHaveBeenCalled();
    });
  });

  describe('updatePill (US2)', () => {
    it('debe permitir editar una píldora si está en estado DRAFT', async () => {
      const result = await service.updatePill('supervisor-1', 'pill-1', {
        title: 'Nuevo Título Editado',
      });

      expect(mockKnowledge.assertPuedeEscribir).toHaveBeenCalledWith('supervisor-1', AgentType.COLLECTIONS);
      expect(mockPrisma.pill.update).toHaveBeenCalled();
      expect(result.title).toBe('Nuevo Título Editado');
    });

    it('debe rechazar la edición si la píldora NO está en estado DRAFT', async () => {
      mockPrisma.pill.findUnique.mockResolvedValueOnce({
        id: 'pill-1',
        status: PillStatus.PUBLISHED,
        module: { sector: { agentType: AgentType.COLLECTIONS } },
      });

      await expect(
        service.updatePill('supervisor-1', 'pill-1', { title: 'Intento de edición' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('publishPill (US2)', () => {
    it('debe publicar la píldora y registrar publishedById y publishedAt', async () => {
      const result = await service.publishPill('supervisor-1', 'pill-1', { indexInKnowledge: false });

      expect(mockKnowledge.assertPuedeEscribir).toHaveBeenCalledWith('supervisor-1', AgentType.COLLECTIONS);
      expect(mockPrisma.pill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PillStatus.PUBLISHED,
            publishedById: 'supervisor-1',
          }),
        }),
      );
      expect(result.status).toBe(PillStatus.PUBLISHED);
      expect(mockKnowledge.ingest).not.toHaveBeenCalled();
    });

    it('debe ingresar la píldora al corpus RAG si indexInKnowledge es true', async () => {
      await service.publishPill('supervisor-1', 'pill-1', { indexInKnowledge: true });

      expect(mockKnowledge.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'CAPACITACION',
          audience: Audience.INTERNO,
          agentType: AgentType.COLLECTIONS,
        }),
      );
    });
  });

  describe('getEmployeeModules (US3)', () => {
    it('debe listar módulos para el empleado calculando candados secuenciales', async () => {
      mockPrisma.trainingModule.findMany.mockResolvedValueOnce([
        {
          id: 'mod-1',
          title: 'Cobranzas',
          sectorId: 'sector-cobranzas',
          pills: [
            { id: 'pill-1', title: 'Pill 1', objective: 'Obj 1', orderIndex: 0, status: PillStatus.PUBLISHED },
            { id: 'pill-2', title: 'Pill 2', objective: 'Obj 2', orderIndex: 1, status: PillStatus.PUBLISHED },
          ],
        },
      ]);
      mockPrisma.employeeProgress.findMany.mockResolvedValueOnce([
        { pillId: 'pill-1', status: TrainingProgressStatus.COMPLETED },
      ]);

      const modules = await service.getEmployeeModules('emp-1');

      expect(modules).toHaveLength(1);
      expect(modules[0].pills).toHaveLength(2);
      expect(modules[0].pills[0].isCompleted).toBe(true);
      expect(modules[0].pills[0].isLocked).toBe(false);
      expect(modules[0].pills[1].isCompleted).toBe(false);
      expect(modules[0].pills[1].isLocked).toBe(false); // Desbloqueada porque pill-1 está completed
    });

    it('debe bloquear la segunda píldora si la primera no está completada', async () => {
      mockPrisma.trainingModule.findMany.mockResolvedValueOnce([
        {
          id: 'mod-1',
          title: 'Cobranzas',
          sectorId: 'sector-cobranzas',
          pills: [
            { id: 'pill-1', title: 'Pill 1', objective: 'Obj 1', orderIndex: 0, status: PillStatus.PUBLISHED },
            { id: 'pill-2', title: 'Pill 2', objective: 'Obj 2', orderIndex: 1, status: PillStatus.PUBLISHED },
          ],
        },
      ]);
      mockPrisma.employeeProgress.findMany.mockResolvedValueOnce([]); // Ninguna completada

      const modules = await service.getEmployeeModules('emp-1');

      expect(modules[0].pills[0].isLocked).toBe(false);
      expect(modules[0].pills[1].isLocked).toBe(true); // Bloqueada
    });
  });

  describe('getEmployeePill (US3)', () => {
    it('debe devolver la píldora ocultando las respuestas correctas', async () => {
      mockPrisma.pill.findUnique.mockResolvedValueOnce({
        id: 'pill-1',
        moduleId: 'mod-1',
        title: 'Píldora Publicada',
        objective: 'Obj',
        content: 'Contenido...',
        status: PillStatus.PUBLISHED,
        orderIndex: 0,
        quiz: [
          { id: 1, question: 'Q1', options: ['A', 'B'], correctOptionIndex: 1, explanation: 'Exp secret' },
        ],
        module: { sectorId: 'sector-cobranzas' },
      });

      const pill = await service.getEmployeePill('emp-1', 'pill-1');

      expect(pill.title).toBe('Píldora Publicada');
      expect(pill.quiz[0].question).toBe('Q1');
      expect((pill.quiz[0] as any).correctOptionIndex).toBeUndefined();
      expect((pill.quiz[0] as any).explanation).toBeUndefined();
    });

    it('debe rechazar el acceso si la píldora es de otro sector', async () => {
      mockPrisma.pill.findUnique.mockResolvedValueOnce({
        id: 'pill-ventas',
        moduleId: 'mod-ventas',
        status: PillStatus.PUBLISHED,
        orderIndex: 0,
        module: { sectorId: 'sector-ventas' },
      });

      await expect(service.getEmployeePill('emp-1', 'pill-ventas')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('verifyQuiz (US4)', () => {
    it('debe registrar error formativo si alguna respuesta es incorrecta', async () => {
      mockPrisma.pill.findUnique.mockResolvedValueOnce({
        id: 'pill-1',
        moduleId: 'mod-1',
        status: PillStatus.PUBLISHED,
        orderIndex: 0,
        quiz: [
          { id: 1, question: 'Q1', options: ['A', 'B'], correctOptionIndex: 0, explanation: 'Regla 1' },
          { id: 2, question: 'Q2', options: ['A', 'B'], correctOptionIndex: 1, explanation: 'Regla 2' },
        ],
      });

      const result = await service.verifyQuiz('emp-1', 'pill-1', [0, 0]); // La segunda es incorrecta

      expect(result.passed).toBe(false);
      expect(result.failedIndices).toContain(1);
      expect(result.explanations).toHaveLength(2);
      expect(mockPrisma.employeeProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: TrainingProgressStatus.IN_PROGRESS }),
        }),
      );
    });

    it('debe aprobar y desbloquear la lección si todas las respuestas son correctas', async () => {
      mockPrisma.pill.findUnique.mockResolvedValueOnce({
        id: 'pill-1',
        moduleId: 'mod-1',
        status: PillStatus.PUBLISHED,
        orderIndex: 0,
        quiz: [
          { id: 1, question: 'Q1', options: ['A', 'B'], correctOptionIndex: 0, explanation: 'Regla 1' },
          { id: 2, question: 'Q2', options: ['A', 'B'], correctOptionIndex: 1, explanation: 'Regla 2' },
        ],
      });
      mockPrisma.pill.findFirst.mockResolvedValueOnce({ id: 'pill-2' }); // Siguiente píldora

      const result = await service.verifyQuiz('emp-1', 'pill-1', [0, 1]); // Ambas correctas

      expect(result.passed).toBe(true);
      expect(result.failedIndices).toHaveLength(0);
      expect(result.nextPillId).toBe('pill-2');
      expect(mockPrisma.employeeProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: TrainingProgressStatus.COMPLETED }),
        }),
      );
    });
  });
});
