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
    getStockCatalog: jest.fn().mockResolvedValue([
      { sku: 'BAL-SYS-CUORA', name: 'Balanza Systel Cuora', stock: 5 },
    ]),
    getProspects: jest.fn().mockResolvedValue([
      { id: 'p-1', name: 'Juan Gómez', status: 'NUEVO' },
    ]),
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
    user: { id: 'emp-diego', sectorName: 'Supervisión', isGeneralSupervisor: true },
  };

  it('permite consultar stock a un vendedor de Ventas', async () => {
    const res = await controller.getStock({ query: 'balanza' }, salesUser);
    expect(res).toBeDefined();
    expect(salesService.getStockCatalog).toHaveBeenCalledWith('balanza', undefined);
  });

  it('permite consultar stock a Diego Bazán (supervisor general)', async () => {
    const res = await controller.getStock({}, supervisorGeneral);
    expect(res).toBeDefined();
  });

  it('rechaza con 403 Forbidden a un empleado de otro sector', async () => {
    expect(() => controller.getStock({}, otherSectorUser)).toThrow(ForbiddenException);
  });

  it('permite verificar crédito comercialmente', async () => {
    const res = await controller.checkCredit({ dni: '30123456' }, salesUser);
    expect(res.verdict).toBe(CreditVerdict.APPROVED);
    expect(salesService.checkCreditCommercial).toHaveBeenCalledWith({ dni: '30123456' });
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
});

