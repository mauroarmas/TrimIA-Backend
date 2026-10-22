import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service';
import { CREDIT_PORT, CreditPort } from '../ai/integrations/ports/credit.port';
import { STOCK_PORT } from '../ai/integrations/ports/stock.port';
import { PrismaService } from '../database/prisma.service';
import { CreditVerdict } from '@prisma/client';

describe('SalesService - Confidencialidad Crediticia (OE-10)', () => {
  let service: SalesService;
  let creditPort: CreditPort;

  const mockCreditPort = {
    evaluateCredit: jest.fn().mockResolvedValue({
      verdict: CreditVerdict.APPROVED_WITH_CONDITIONS,
      score: 640,
      reason: 'Deuda registrada en BCRA por $120.000 con mora nivel 2',
      commercialCondition: 'Aprobado con anticipo del 20% y máximo 12 cuotas semanales.',
      rawReport: {
        bcraSituation: 2,
        totalDebt: 120000,
        bureauScore: 640,
      },
      assessedAt: new Date(),
    }),
  };

  const mockStockPort = {
    listCatalog: jest.fn(),
  };

  const mockPrisma = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: CREDIT_PORT, useValue: mockCreditPort },
        { provide: STOCK_PORT, useValue: mockStockPort },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    creditPort = module.get<CreditPort>(CREDIT_PORT);
  });

  it('debe devolver solo el dictamen comercial y omitir datos confidenciales (score, rawReport, reason técnico)', async () => {
    const res: any = await service.checkCreditCommercial({ dni: '32123454', amount: 200000 });

    // Campos permitidos
    expect(res.verdict).toBe(CreditVerdict.APPROVED_WITH_CONDITIONS);
    expect(res.commercialCondition).toContain('anticipo');
    expect(res.evaluatedAt).toBeDefined();

    // Campos confidenciales PROHIBIDOS para el área comercial (OE-10)
    expect(res.score).toBeUndefined();
    expect(res.rawReport).toBeUndefined();
    expect(res.reason).toBeUndefined();
    expect(res.bcraSituation).toBeUndefined();
  });
});

