import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { ClientOnboardingService } from './client-onboarding.service';
import { CreditVerdict, PaymentModality } from '@prisma/client';

describe('SalesController', () => {
  let controller: SalesController;
  let salesService: SalesService;

  const mockOnboarding = {
    createClient: jest.fn(),
  };

  const mockSalesService = {
    getStockCatalog: jest
      .fn()
      .mockResolvedValue([
        { sku: 'BAL-SYS-CUORA', name: 'Balanza Systel Cuora', stock: 5 },
      ]),
    getProspects: jest
      .fn()
      .mockResolvedValue([{ id: 'p-1', name: 'Juan Gómez', status: 'NUEVO' }]),
    checkCreditCommercial: jest.fn().mockResolvedValue({
      verdict: CreditVerdict.APPROVED,
      commercialCondition: 'Aprobado sin anticipo',
      evaluatedAt: new Date(),
    }),
    closeSale: jest.fn().mockResolvedValue({
      success: true,
      closedAt: new Date().toISOString(),
      closedById: 'emp-1',
    }),
    createFinancingPlan: jest.fn().mockResolvedValue({ id: 'plan-1' }),
    getFinancingDraft: jest.fn().mockResolvedValue({ version: 1 }),
    completeFinancingDraft: jest.fn().mockResolvedValue({ version: 2 }),
    listFinancingRequests: jest.fn().mockResolvedValue([]),
    reviewFinancingRequest: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
    getFollowUpRule: jest.fn().mockResolvedValue({
      id: 'default',
      enabled: false,
      inactivityHours: 48,
      version: 1,
      transportMode: 'simulated',
    }),
    updateFollowUpRule: jest.fn().mockResolvedValue({
      id: 'default',
      enabled: true,
      inactivityHours: 48,
      version: 2,
      transportMode: 'simulated',
    }),
    getProspectFollowUpStatus: jest.fn().mockResolvedValue({
      prospectId: 'p-1',
      status: 'SCHEDULED',
      crmSyncStatus: 'SYNCED',
    }),
    simulateProspectFollowUpDue: jest.fn().mockResolvedValue({
      prospectId: 'p-1',
      status: 'COMPLETED',
      crmSyncStatus: 'SYNCED',
    }),
    syncProspectCrm: jest.fn().mockResolvedValue({
      prospectId: 'p-1',
      syncStatus: 'SYNCED',
      remoteSynced: true,
    }),
    getContactPreference: jest.fn().mockResolvedValue({
      phone: '+5493764000222',
      optOut: true,
      history: [{ action: 'OPT_OUT', reason: 'BAJA' }],
    }),
    optOutContactPreference: jest.fn().mockResolvedValue({
      phone: '+5493764000222',
      optOut: true,
      history: [{ action: 'OPT_OUT', reason: 'BAJA' }],
    }),
    reactivateContactPreference: jest.fn().mockResolvedValue({
      phone: '+5493764000222',
      optOut: false,
      history: [
        { action: 'OPT_OUT', reason: 'BAJA' },
        { action: 'REACTIVATED', reason: 'Solicitud expresa del contacto' },
      ],
    }),
    simulateFinancingNoticeDelivery: jest.fn().mockResolvedValue({
      id: 'notice-1',
      status: 'DELIVERED',
      deliverySource: 'simulated',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        { provide: ClientOnboardingService, useValue: mockOnboarding },
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();

    controller = module.get<SalesController>(SalesController);
    salesService = module.get<SalesService>(SalesService);
  });

  const salesUser = {
    user: { id: 'emp-1', sectorName: 'Ventas', isGeneralSupervisor: false },
  };

  const otherSectorUser = {
    user: { id: 'emp-2', sectorName: 'Cobranzas', isGeneralSupervisor: false },
  };

  const supervisorGeneral = {
    user: {
      id: 'emp-diego',
      sectorName: 'Supervisión',
      isGeneralSupervisor: true,
    },
  };

  it('permite consultar stock a un vendedor de Ventas', async () => {
    const res = await controller.getStock({ query: 'balanza' }, salesUser);
    expect(res).toBeDefined();
    expect(salesService.getStockCatalog).toHaveBeenCalledWith(
      'balanza',
      undefined,
    );
  });

  it('reserva la bandeja financiera a Administración y supervisión general', async () => {
    expect(() => controller.listFinancing(salesUser)).toThrow(
      ForbiddenException,
    );
    expect(
      await controller.listFinancing({
        user: { role: 'EMPLEADO', sectorName: 'Administración' },
      }),
    ).toEqual([]);
    expect(await controller.listFinancing(supervisorGeneral)).toEqual([]);
  });

  it('Diego como supervisor de Ventas puede confirmar el precio comercial sin acceso a dictámenes', async () => {
    const diego = {
      user: {
        id: 'diego',
        role: 'SUPERVISOR',
        sectorName: 'Ventas',
        isGeneralSupervisor: false,
      },
    };
    const dto = {
      expectedVersion: 1,
      confirmedAmount: '2000000.00',
      note: 'Precio confirmado al cliente',
    };
    await controller.financingDraft('conv-1', diego);
    await controller.completeFinancingDraft('conv-1', dto, diego);
    expect(mockSalesService.completeFinancingDraft).toHaveBeenCalledWith(
      'conv-1',
      dto,
      'diego',
    );
    expect(() => controller.listFinancing(diego)).toThrow(ForbiddenException);
  });
  it.each([
    { role: 'EMPLEADO', sectorName: 'Ventas' },
    { role: 'SUPERVISOR', sectorName: 'Cobranzas' },
    { role: 'EMPLEADO', sectorName: 'Administración' },
  ])('no permite confirmar precios a quien no está autorizado: %p', (user) => {
    expect(() =>
      controller.completeFinancingDraft(
        'conv-1',
        { expectedVersion: 1, confirmedAmount: '1.00', note: 'Precio' },
        { user },
      ),
    ).toThrow(ForbiddenException);
  });
  it('un administrativo puede consultar pero solo un supervisor puede decidir', async () => {
    expect(() =>
      controller.reviewFinancing(
        'request-1',
        { expectedVersion: 1, decision: 'APPROVED' },
        {
          user: {
            id: 'admin-1',
            role: 'EMPLEADO',
            sectorName: 'Administración',
          },
        },
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      controller.reviewFinancing(
        'request-1',
        { expectedVersion: 1, decision: 'APPROVED' },
        { user: { id: 'sales-1', role: 'SUPERVISOR', sectorName: 'Ventas' } },
      ),
    ).toThrow(ForbiddenException);
    await controller.reviewFinancing(
      'request-1',
      { expectedVersion: 1, decision: 'APPROVED' },
      {
        user: {
          id: 'supervisor-1',
          role: 'SUPERVISOR',
          isGeneralSupervisor: true,
        },
      },
    );
    expect(mockSalesService.reviewFinancingRequest).toHaveBeenCalledWith(
      'request-1',
      { expectedVersion: 1, decision: 'APPROVED' },
      'supervisor-1',
    );
  });

  it('reserva el alta de cuotas a supervisión financiera habilitada', async () => {
    const dto = {
      expectedVersion: 2,
      quotaCount: 12,
      firstDueDate: '2026-11-13',
      collectorId: 'collector',
      note: 'Acuerdo',
    };
    expect(() =>
      controller.createFinancingPlan('r', dto, {
        user: { role: 'SUPERVISOR', sectorName: 'Ventas' },
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      controller.createFinancingPlan('r', dto, {
        user: { role: 'EMPLEADO', sectorName: 'Administración' },
      }),
    ).toThrow(ForbiddenException);
    await controller.createFinancingPlan('r', dto, {
      user: { id: 'diego', role: 'SUPERVISOR', isGeneralSupervisor: true },
    });
    expect(mockSalesService.createFinancingPlan).toHaveBeenCalledWith(
      'r',
      dto,
      'diego',
    );
  });
  it('permite consultar stock a Diego Bazán (supervisor general)', async () => {
    const res = await controller.getStock({}, supervisorGeneral);
    expect(res).toBeDefined();
  });

  it('rechaza con 403 Forbidden a un empleado de otro sector', async () => {
    expect(() => controller.getStock({}, otherSectorUser)).toThrow(
      ForbiddenException,
    );
  });

  it('permite verificar crédito comercialmente', async () => {
    const res = await controller.checkCredit({ dni: '30123456' }, salesUser);
    expect(res.verdict).toBe(CreditVerdict.APPROVED);
    expect(salesService.checkCreditCommercial).toHaveBeenCalledWith({
      dni: '30123456',
    });
  });

  it('permite registrar el cierre manual de venta', async () => {
    const res = await controller.closeSale(
      {
        finalAmount: 420000,
        modality: PaymentModality.CASH,
        notes: 'Factura A-0001 emitida',
      },
      salesUser,
    );
    expect(res.success).toBe(true);
    expect(salesService.closeSale).toHaveBeenCalled();
  });

  describe('Seguimiento comercial 021 — permisos y contratos de controlador (US3)', () => {
    it('permite consultar la regla global y el estado de seguimiento a Ventas y a supervisión general', async () => {
      await expect(controller.getFollowUpRule(salesUser)).resolves.toMatchObject(
        {
          inactivityHours: 48,
        },
      );
      await expect(
        controller.getFollowUpRule(supervisorGeneral),
      ).resolves.toMatchObject({
        inactivityHours: 48,
      });
      await expect(
        controller.getProspectFollowUpStatus('p-1', salesUser),
      ).resolves.toMatchObject({
        prospectId: 'p-1',
        status: 'SCHEDULED',
      });
    });

    it('rechaza con 403 la modificación de la regla global por parte de un vendedor o supervisor de sector sin supervisión general (US3.5)', () => {
      const dto = { enabled: true, inactivityHours: 48, expectedVersion: 1 };
      expect(() => controller.updateFollowUpRule(dto, salesUser)).toThrow(
        ForbiddenException,
      );
      expect(() =>
        controller.updateFollowUpRule(dto, {
          user: {
            id: 'sales-sup',
            role: 'SUPERVISOR',
            sectorName: 'Ventas',
            isGeneralSupervisor: false,
          },
        }),
      ).toThrow(ForbiddenException);
    });

    it('permite a supervisión general modificar la regla global y ejercitar simulate-due y crm-sync desde Ventas (FR-001, FR-002, FR-011)', async () => {
      const dto = { enabled: true, inactivityHours: 48, expectedVersion: 1 };
      const updated = await controller.updateFollowUpRule(
        dto,
        supervisorGeneral,
      );
      expect(updated.enabled).toBe(true);
      expect(mockSalesService.updateFollowUpRule).toHaveBeenCalledWith(
        dto,
        'emp-diego',
      );

      const sim = await controller.simulateProspectFollowUpDue(
        'p-1',
        salesUser,
      );
      expect(sim.status).toBe('COMPLETED');

      const synced = await controller.syncProspectCrm('p-1', salesUser);
      expect(synced.syncStatus).toBe('SYNCED');
    });

    it('022: permite consultar preferencia, registrar baja y simular confirmación de entrega, y restringe la reactivación a supervisión general (FR-004, FR-006)', async () => {
      const pref = await controller.getContactPreference(
        '+5493764000222',
        salesUser,
      );
      expect(pref.optOut).toBe(true);

      const optOut = await controller.optOutContactPreference(
        '+5493764000222',
        { reason: 'BAJA' },
        salesUser,
      );
      expect(optOut.optOut).toBe(true);

      expect(() =>
        controller.reactivateContactPreference(
          '+5493764000222',
          { reason: 'Solicitud expresa del contacto' },
          salesUser,
        ),
      ).toThrow(ForbiddenException);

      const reactivated = await controller.reactivateContactPreference(
        '+5493764000222',
        { reason: 'Solicitud expresa del contacto' },
        supervisorGeneral,
      );
      expect(reactivated.optOut).toBe(false);
      expect(reactivated.history).toHaveLength(2);

      const delivered = await controller.simulateFinancingNoticeDelivery(
        'notice-1',
        { providerMessageId: 'sim:notice-1' },
        salesUser,
      );
      expect(delivered.status).toBe('DELIVERED');
      expect(delivered.deliverySource).toBe('simulated');
    });
  });
});
