import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { N8nCrmAdapter } from './n8n-crm.adapter';
import { CrmProspectRecord, ProspectStatus } from '../ports/crm.port';
import { ProspectSyncStatus } from '@prisma/client';

describe('N8nCrmAdapter', () => {
  let adapter: N8nCrmAdapter;
  let prisma: PrismaService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'N8N_BASE_URL') return 'http://localhost:5678';
      return null;
    }),
  };

  const mockPrismaService = {
    prospect: {
      create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'uuid-1', ...args.data })),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'uuid-1' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        N8nCrmAdapter,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    adapter = module.get<N8nCrmAdapter>(N8nCrmAdapter);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const sampleProspect: CrmProspectRecord = {
    fechaContacto: '21/10/2026',
    nombreApellido: 'Carlos Mendoza',
    telefono: '+5493764112233',
    dni: '30123456',
    comercio: 'Panadería San Martín',
    rubro: 'Gastronomía',
    localidad: 'Posadas',
    productoInteres: 'Balanza Systel Cuora',
    modalidad: 'CONTADO',
    montoEstimado: 350000,
    estado: ProspectStatus.NUEVO,
    canalOrigen: 'WHATSAPP',
    ultimaInteraccion: '21/10/2026 14:00',
    notasSeguimiento: 'Consulta inicial por balanza',
  };

  it('debe registrar el prospecto localmente con estado SYNCED si n8n responde 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, rowId: 'row-123' }),
    } as any);

    const res = await adapter.createProspect(sampleProspect);
    expect(res.success).toBe(true);
    expect(prisma.prospect.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: sampleProspect.telefono,
          syncStatus: ProspectSyncStatus.SYNCED,
        }),
      }),
    );
  });

  it('debe activar fallback local con estado PENDING si n8n arroja error de red o timeout', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const res = await adapter.createProspect(sampleProspect);
    expect(res.success).toBe(true);
    expect(prisma.prospect.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: sampleProspect.telefono,
          syncStatus: ProspectSyncStatus.PENDING,
        }),
      }),
    );
  });
});

