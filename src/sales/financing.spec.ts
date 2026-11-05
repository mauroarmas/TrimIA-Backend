import { ConflictException, NotFoundException } from '@nestjs/common';
import { SalesService } from './sales.service';

describe('Revisión de financiación persistida', () => {
  const request = {
    id: 'request-1',
    status: 'PENDING_REVIEW',
    modality: 'FINANCED',
    amount: '120000.00',
  };
  let service: SalesService;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      purchaseRequest: {
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(request),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new SalesService(null, null, prisma);
  });
  it('devuelve una bandeja vacía cuando no hay solicitudes y excluye los reportes bancarios crudos', async () => {
    expect(await service.listFinancingRequests()).toEqual([]);
    const query = prisma.purchaseRequest.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ modality: 'FINANCED' });
    expect(query.select.creditAssessments.select).not.toHaveProperty(
      'rawPayload',
    );
    expect(query.select.client.select).not.toHaveProperty('assignedCollector');
  });
  it.each(['APPROVED', 'REJECTED'] as const)(
    'persiste %s con supervisor, fecha y nota',
    async (decision) => {
      await service.reviewFinancingRequest(
        'request-1',
        { decision, note: ' Revisión manual ' },
        'supervisor-1',
      );
      expect(prisma.purchaseRequest.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'request-1',
          modality: 'FINANCED',
          status: 'PENDING_REVIEW',
        },
        data: {
          status: decision,
          reviewedById: 'supervisor-1',
          reviewedAt: expect.any(Date),
          reviewNote: 'Revisión manual',
        },
      });
    },
  );
  it('no pisa la decisión de otro supervisor que resolvió antes', async () => {
    prisma.purchaseRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.reviewFinancingRequest(
        'request-1',
        { decision: 'REJECTED' },
        'supervisor-2',
      ),
    ).rejects.toThrow(ConflictException);
  });
  it.each([null, '0', '-1'])(
    'no aprueba una financiación sin monto positivo (%s)',
    async (amount) => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...request,
        amount,
      });
      await expect(
        service.reviewFinancingRequest(
          'request-1',
          { decision: 'APPROVED' },
          'supervisor-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.purchaseRequest.updateMany).not.toHaveBeenCalled();
    },
  );
  it('rechaza solicitudes inexistentes o de contado', async () => {
    prisma.purchaseRequest.findUnique.mockResolvedValue({
      ...request,
      modality: 'CASH',
    });
    await expect(
      service.reviewFinancingRequest(
        'request-1',
        { decision: 'APPROVED' },
        'supervisor-1',
      ),
    ).rejects.toThrow(NotFoundException);
    prisma.purchaseRequest.findUnique.mockResolvedValue(null);
    await expect(
      service.reviewFinancingRequest(
        'missing',
        { decision: 'REJECTED' },
        'supervisor-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('el cierre comercial no permite aprobar una financiación pendiente', async () => {
    await expect(
      service.closeSale(
        {
          purchaseRequestId: 'request-1',
          finalAmount: 120000,
          modality: 'FINANCED',
          notes: 'Cierre',
        },
        'seller-1',
      ),
    ).rejects.toThrow(/aprobada por un supervisor/);
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it('el cierre no cambia la decisión ni el monto aprobado del supervisor', async () => {
    prisma.purchaseRequest.findUnique.mockResolvedValue({
      ...request,
      status: 'APPROVED',
    });
    await expect(
      service.closeSale(
        {
          purchaseRequestId: 'request-1',
          finalAmount: 1,
          modality: 'FINANCED',
          notes: 'Cierre',
        },
        'seller-1',
      ),
    ).rejects.toThrow(/monto del cierre/);
    const result = await service.closeSale(
      {
        purchaseRequestId: 'request-1',
        finalAmount: 120000,
        modality: 'FINANCED',
        notes: 'Cierre',
      },
      'seller-1',
    );
    expect(result.success).toBe(true);
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });
});
