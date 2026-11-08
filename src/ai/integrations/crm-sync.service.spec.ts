import { Test, TestingModule } from '@nestjs/testing';
import { CrmSyncService } from './crm-sync.service';
import { CRM_PORT, CrmPort } from './ports/crm.port';
import { PrismaService } from '../../database/prisma.service';

describe('CrmSyncService', () => {
  let service: CrmSyncService;
  let crmPort: CrmPort;
  let prisma: PrismaService;

  const mockCrmPort = {
    createProspect: jest
      .fn()
      .mockResolvedValue({ success: true, id: 'p-1', remoteSynced: true }),
    searchProspect: jest.fn(),
    addFollowUp: jest.fn(),
  };

  const mockPrismaService = {
    prospect: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmSyncService,
        { provide: CRM_PORT, useValue: mockCrmPort },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CrmSyncService>(CrmSyncService);
    crmPort = module.get<CrmPort>(CRM_PORT);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debe reintentar la sincronización de prospectos con estado PENDING', async () => {
    mockPrismaService.prospect.findMany.mockResolvedValue([
      {
        id: 'p-1',
        name: 'Roberto Gómez',
        phone: '+5493764998877',
        productInterest: 'Sobadora Santini',
        modality: 'CASH',
        status: 'NUEVO',
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: 'Interesado contado',
      },
    ]);

    const count = await service.syncPendingProspects();
    expect(count).toBe(1);
    expect(crmPort.createProspect).toHaveBeenCalled();
    expect(crmPort.createProspect).toHaveBeenCalledWith(
      expect.objectContaining({ localId: 'p-1' }),
    );
    expect(prisma.prospect.update).not.toHaveBeenCalled();
  });

  it('permite sincronizar manualmente una oportunidad pendiente por ID sin repetir envíos al cliente (021 FR-011)', async () => {
    const now = new Date('2026-11-07T19:00:00.000Z');
    mockPrismaService.prospect.findUnique.mockResolvedValue({
      id: 'p-2',
      name: 'Comercio Demo',
      phone: '+5493764000211',
      productInterest: 'Cortadora Berkley',
      modality: 'CASH',
      status: 'EN_CONTACTO',
      syncStatus: 'PENDING',
      createdAt: now,
      updatedAt: now,
      notes: '[SEGUIMIENTO AUTOMÁTICO] Recordatorio enviado',
    });
    mockPrismaService.prospect.findUniqueOrThrow.mockResolvedValue({
      id: 'p-2',
      syncStatus: 'SYNCED',
      lastSyncedAt: now,
    });

    const res = await service.syncProspectById('p-2');
    expect(res).toEqual({
      prospectId: 'p-2',
      syncStatus: 'SYNCED',
      remoteSynced: true,
      lastSyncedAt: now.toISOString(),
    });
    expect(crmPort.createProspect).toHaveBeenCalledTimes(1);
  });
});
