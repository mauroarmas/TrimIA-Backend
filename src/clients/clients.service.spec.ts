import { ConflictException } from '@nestjs/common';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: any;
  let crm: any;

  beforeEach(() => {
    prisma = {
      client: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    crm = { upsertClient: jest.fn().mockResolvedValue(undefined) };
    service = new ClientsService(prisma, crm);
  });

  describe('createWithQuotas (US6 — alta por el vendedor)', () => {
    const dto = {
      name: 'Juan Pérez',
      phone: '3865505362',
      dni: '30111222',
      quotas: [
        { amount: 42000, dueDate: '2026-09-10' },
        { amount: 42000, dueDate: '2026-10-10' },
      ],
    };

    it('crea el cliente con sus cuotas en una sola operación', async () => {
      prisma.client.create.mockResolvedValue({
        id: 'cli-1',
        name: 'Juan Pérez',
        phone: '5493865505362',
        dni: '30111222',
        quotas: [{ id: 'q1' }, { id: 'q2' }],
      });

      const result = await service.createWithQuotas(dto);

      const data = prisma.client.create.mock.calls[0][0].data;
      expect(data.quotas.create).toHaveLength(2);
      expect(data.quotas.create[0].dueDate).toBeInstanceOf(Date);
      expect(result.quotas).toHaveLength(2);
    });

    it('normaliza el teléfono antes de guardar', async () => {
      prisma.client.create.mockResolvedValue({
        id: 'cli-1',
        quotas: [],
        phone: 'x',
      });

      await service.createWithQuotas(dto);

      const data = prisma.client.create.mock.calls[0][0].data;
      // normalizePhone canoniza a formato AR completo; lo que importa es que
      // NO se guarde el string crudo que escribió el vendedor.
      expect(data.phone).not.toBe('3865505362');
    });

    it('rechaza (409) si el teléfono ya pertenece a un cliente (US6/AC3)', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: 'ya-existe' });

      await expect(service.createWithQuotas(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it('acepta un alta sin cobrador asignado (FR-001b)', async () => {
      prisma.client.create.mockResolvedValue({ id: 'cli-1', quotas: [] });

      await service.createWithQuotas(dto);

      const data = prisma.client.create.mock.calls[0][0].data;
      expect(data.assignedCollectorId).toBeUndefined();
    });

    it('replica el alta hacia el CRM', async () => {
      prisma.client.create.mockResolvedValue({
        id: 'cli-1',
        name: 'Juan Pérez',
        phone: '5493865505362',
        dni: '30111222',
        quotas: [{ id: 'q1' }],
      });

      await service.createWithQuotas(dto);

      expect(crm.upsertClient).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '5493865505362', quotaCount: 1 }),
      );
    });

    // Postgres es la fuente de verdad; el Sheets es copia de ida. Si la copia
    // falla, el cliente igual quedó dado de alta.
    it('no revierte el alta si la escritura al CRM falla', async () => {
      prisma.client.create.mockResolvedValue({ id: 'cli-1', quotas: [] });
      crm.upsertClient.mockRejectedValue(new Error('Sheets caído'));

      const result = await service.createWithQuotas(dto);

      expect(result.id).toBe('cli-1');
    });
  });
});
