import { ClientAccountService } from './client-account.service';

describe('ClientAccountService', () => {
  const prisma: any = {
    conversation: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
    purchaseRequest: { findMany: jest.fn() },
    quota: { findMany: jest.fn() },
  };
  const service = new ClientAccountService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('devuelve null para empleados o conversaciones inexistentes', async () => {
    prisma.conversation.findUnique.mockResolvedValueOnce(null);
    expect(await service.getAccountSummary('conv-1')).toBeNull();

    prisma.conversation.findUnique.mockResolvedValueOnce({
      id: 'conv-2',
      clientId: null,
      externalId: '5493764000001',
      userType: 'EMPLEADO',
    });
    expect(await service.getAccountSummary('conv-2')).toBeNull();
    expect(prisma.client.findUnique).not.toHaveBeenCalled();
  });

  it('recupera compras cerradas al contado y cuotas pendientes del cliente de la conversación', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv-1',
      clientId: 'client-1',
      externalId: '5493764329154',
      userType: 'CLIENTE',
    });
    prisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Emmanuel Arnedo',
    });
    prisma.purchaseRequest.findMany.mockResolvedValue([
      {
        id: 'req-1',
        productSummary: 'Balanza Comercial Moretti 40kg con Batería',
        amount: '165000.00',
        modality: 'FINANCED',
        closedAt: new Date('2026-11-21T23:16:00Z'),
        commercialFlow: {
          version: 2,
          stage: 'CLOSED',
          selectedOfferId: 'cash',
          deliveryMode: 'PICKUP',
          offers: [
            {
              id: 'cash',
              label: 'Contado',
              modality: 'CASH',
              total: '140000.00',
              quotaCount: 0,
              frequency: null,
            },
          ],
        },
        financing: null,
      },
    ]);
    prisma.quota.findMany.mockResolvedValue([]);

    const summary = await service.getAccountSummary('conv-1');

    expect(summary).toEqual({
      cliente: 'Emmanuel Arnedo',
      comprasCerradas: [
        {
          producto: 'Balanza Comercial Moretti 40kg con Batería',
          fechaCierre: '2026-11-21',
          modalidad: 'Contado',
          importeTotal: expect.stringContaining('140.000,00'),
          entrega: 'Retiro en sucursal (sin costo de envío)',
        },
      ],
      cuotasPendientes: [],
    });
  });

  it('incluye resumen de cuotas pendientes para compras financiadas', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv-2',
      clientId: null,
      externalId: '5493764329154',
      userType: 'CLIENTE',
    });
    prisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Emmanuel Arnedo',
    });
    prisma.purchaseRequest.findMany.mockResolvedValue([
      {
        id: 'req-2',
        productSummary: 'Cortadora Berkley 300mm',
        amount: '610000.00',
        modality: 'FINANCED',
        closedAt: new Date('2026-11-20T12:00:00Z'),
        commercialFlow: {
          version: 2,
          stage: 'CLOSED',
          selectedOfferId: 'weekly-12',
          deliveryMode: 'SHIPPING',
          deliveryAddress: 'Av. Mitre 123',
          shippingCost: '15000.00',
          offers: [
            {
              id: 'weekly-12',
              label: '12 cuotas semanales',
              modality: 'FINANCED',
              total: '610000.00',
              quotaCount: 12,
              frequency: 'WEEKLY',
            },
          ],
        },
        financing: {
          totalAmount: '610000.00',
          quotaCount: 12,
          quotas: [
            {
              number: 1,
              amount: '50833.33',
              dueDate: new Date('2026-11-27T00:00:00Z'),
              status: 'PENDING',
            },
          ],
        },
      },
    ]);
    prisma.quota.findMany.mockResolvedValue([
      {
        number: 1,
        amount: '50833.33',
        dueDate: new Date('2026-11-27T00:00:00Z'),
        status: 'PENDING',
      },
    ]);

    const summary = await service.getAccountSummary('conv-2');

    expect(summary?.comprasCerradas[0]).toMatchObject({
      producto: 'Cortadora Berkley 300mm',
      modalidad: '12 cuotas semanales',
      entrega: 'Envío a Av. Mitre 123',
      costoEnvioAparte: expect.stringContaining('15.000,00'),
      cuotas: {
        total: 12,
        pagadas: 0,
        pendientes: 1,
        proximaCuota: {
          numero: 1,
          vencimiento: '2026-11-27',
          estado: 'pendiente',
        },
      },
    });
    expect(summary?.cuotasPendientes).toHaveLength(1);
  });
});
