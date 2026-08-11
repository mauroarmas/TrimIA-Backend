import { ClientOnboardingService } from './client-onboarding.service';

describe('ClientOnboardingService (US6)', () => {
  let service: ClientOnboardingService;
  let clients: any;
  let paymentProofs: any;
  let logger: any;

  const dto = {
    name: 'Juan Pérez',
    phone: '5493865505362',
    quotas: [{ amount: 42000, dueDate: '2026-09-10' }],
  };

  beforeEach(() => {
    clients = {
      createWithQuotas: jest.fn().mockResolvedValue({
        id: 'cli-1',
        phone: '5493865505362',
        assignedCollectorId: null,
        quotas: [{ id: 'q1' }],
      }),
    };
    paymentProofs = {
      reconcileUnmatchedForPhone: jest.fn().mockResolvedValue([]),
    };
    logger = { logEvent: jest.fn() };
    service = new ClientOnboardingService(clients, paymentProofs, logger);
  });

  it('audita el alta con quién la hizo y cuántas cuotas quedaron (US6/AC1, FR-018)', async () => {
    await service.createClient(dto as any, 'emp-vendedor');

    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'client_created',
        payload: expect.objectContaining({
          clientId: 'cli-1',
          createdById: 'emp-vendedor',
          quotaCount: 1,
        }),
      }),
    );
  });

  it('recupera los comprobantes que habían quedado huérfanos de ese teléfono (FR-006b)', async () => {
    paymentProofs.reconcileUnmatchedForPhone.mockResolvedValue([
      { id: 'proof-1' },
      { id: 'proof-2' },
    ]);

    const result = await service.createClient(dto as any, 'emp-vendedor');

    expect(paymentProofs.reconcileUnmatchedForPhone).toHaveBeenCalledWith(
      '5493865505362',
      'cli-1',
    );
    expect(result.recoveredProofs).toBe(2);
  });

  // El alta ya está confirmada en base; que falle la recuperación no puede
  // deshacerla ni devolverle un error al vendedor.
  it('no tira abajo el alta si la recuperación de comprobantes falla', async () => {
    paymentProofs.reconcileUnmatchedForPhone.mockRejectedValue(
      new Error('boom'),
    );

    const result = await service.createClient(dto as any, 'emp-vendedor');

    expect(result.id).toBe('cli-1');
    expect(result.recoveredProofs).toBe(0);
  });
});
