import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SalesService } from './sales.service';

describe('Cierre comercial: destino válido y auditoría local', () => {
  let service: SalesService;
  let db: any;
  let prospect: any;
  let request: any;
  const dto: any = {
    prospectId: 'p1',
    finalAmount: 1500,
    modality: 'CASH',
    notes: 'Factura revisada',
  };
  beforeEach(() => {
    prospect = { id: 'p1', status: 'NUEVO', notes: 'Consulta', closedAt: null };
    request = {
      id: 'r1',
      status: 'APPROVED',
      modality: 'FINANCED',
      amount: 1500,
      closedAt: null,
    };
    db = {
      prospect: {
        findUnique: jest.fn(async () => prospect),
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async ({ data }) => {
          Object.assign(prospect, data);
          return { count: 1 };
        }),
      },
      purchaseRequest: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => request),
        updateMany: jest.fn(async ({ data }) => {
          Object.assign(request, data);
          return { count: 1 };
        }),
      },
    };
    db.$transaction = jest.fn((fn) => fn(db));
    service = new SalesService(null, null, db);
  });
  it.each([
    {},
    { prospectId: 'p1', finalAmount: 0 },
    { prospectId: 'p1', finalAmount: -1 },
  ])('rechaza destino ausente o monto inválido', async (partial) => {
    await expect(
      service.closeSale(
        { ...dto, prospectId: undefined, ...partial },
        'seller',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(db.prospect.updateMany).not.toHaveBeenCalled();
  });
  it('no ignora un prospecto inexistente', async () => {
    prospect = null;
    await expect(service.closeSale(dto, 'seller')).rejects.toThrow(
      NotFoundException,
    );
  });
  it('valida ambos destinos antes de escribir el primero', async () => {
    request.status = 'PENDING_REVIEW';
    await expect(
      service.closeSale(
        { ...dto, purchaseRequestId: 'r1', modality: 'FINANCED' },
        'seller',
      ),
    ).rejects.toThrow(ConflictException);
    expect(db.prospect.updateMany).not.toHaveBeenCalled();
    expect(db.purchaseRequest.updateMany).not.toHaveBeenCalled();
  });
  it('persiste fecha, vendedor y monto; repetir no pisa la auditoría', async () => {
    const first = await service.closeSale(dto, 'seller');
    expect(prospect.closedAt).toBeInstanceOf(Date);
    expect(prospect.sellerId).toBe('seller');
    const second = await service.closeSale(dto, 'other');
    expect(second.closedAt).toEqual(first.closedAt);
    expect(second.closedById).toBe('seller');
    expect(db.prospect.updateMany).toHaveBeenCalledTimes(1);
  });
  it('registra cierre financiado sin modificar la aprobación del supervisor', async () => {
    await service.closeSale(
      {
        ...dto,
        prospectId: undefined,
        purchaseRequestId: 'r1',
        modality: 'FINANCED',
      },
      'seller',
    );
    const data = db.purchaseRequest.updateMany.mock.calls[0][0].data;
    expect(data).toHaveProperty('closedById', 'seller');
    expect(data).not.toHaveProperty('reviewedById');
    expect(data).not.toHaveProperty('amount');
  });
  it('cerrar por solicitud actualiza también su oportunidad vinculada sin duplicar el cierre', async () => {
    request.prospectId = 'p1';
    const input = {
      purchaseRequestId: 'r1',
      finalAmount: 1500,
      modality: 'FINANCED',
      notes: 'Registro de prueba',
    } as any;
    await service.closeSale(input, 'seller');
    expect(prospect.status).toBe('VENTA_CERRADA');
    expect(prospect.syncStatus).toBe('PENDING');
    expect(request.closedAt).toEqual(prospect.closedAt);
    await service.closeSale(input, 'other');
    expect(db.prospect.updateMany).toHaveBeenCalledTimes(1);
    expect(request.closedById).toBe('seller');
  });
  it('rechaza cerrar una oportunidad ajena a la solicitud', async () => {
    request.prospectId = 'another';
    await expect(
      service.closeSale(
        { ...dto, purchaseRequestId: 'r1', modality: 'FINANCED' },
        'seller',
      ),
    ).rejects.toThrow(ConflictException);
    expect(db.prospect.updateMany).not.toHaveBeenCalled();
  });
  it('el listado de pendientes excluye cerrados pero respeta filtro explícito', async () => {
    await service.getProspects();
    expect(db.prospect.findMany.mock.calls[0][0].where.status).toEqual({
      notIn: ['VENTA_CERRADA', 'PERDIDO'],
    });
    await service.getProspects('VENTA_CERRADA');
    expect(db.prospect.findMany.mock.calls[1][0].where.status).toBe(
      'VENTA_CERRADA',
    );
  });
});
