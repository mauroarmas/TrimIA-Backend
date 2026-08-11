import { DevToolsService } from './dev-tools.service';
import { PrismaService } from '../database/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { ClientsService } from '../clients/clients.service';
import { ClientFixture } from './dto/set-client-fixtures.dto';

/**
 * Tests de DevToolsService: deja al cliente de prueba en una situación
 * concreta para poder repetir un flujo de WhatsApp de cero. Todo mockeado.
 */
describe('DevToolsService', () => {
  const phone = '5493865505362';

  let service: DevToolsService;
  let prisma: {
    employee: { findFirst: jest.Mock };
    quota: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    paymentProof: { deleteMany: jest.Mock };
    conversation: { updateMany: jest.Mock };
  };
  let employees: { findByPhone: jest.Mock; update: jest.Mock };
  let clients: { getByPhone: jest.Mock; create: jest.Mock };

  beforeEach(() => {
    prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
      quota: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      paymentProof: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      conversation: { updateMany: jest.fn() },
    };
    employees = { findByPhone: jest.fn().mockResolvedValue(null), update: jest.fn() };
    clients = {
      getByPhone: jest.fn().mockResolvedValue({ id: 'client-1', phone }),
      create: jest.fn().mockResolvedValue({ id: 'client-1', phone }),
    };

    service = new DevToolsService(
      prisma as unknown as PrismaService,
      employees as unknown as EmployeesService,
      clients as unknown as ClientsService,
    );
  });

  // El Client debe existir siempre: es lo que enlaza Conversation.clientId.
  it('crea el Client si no existe', async () => {
    clients.getByPhone.mockResolvedValue(null);

    await service.setClientFixtures({
      phone,
      fixtures: [ClientFixture.CUOTA_POR_VENCER],
    });

    expect(clients.create).toHaveBeenCalledWith(
      expect.objectContaining({ phone }),
    );
  });

  // Si el número quedó como empleado de una prueba vieja, el MessageProcessor
  // lo resolvería como userType=EMPLEADO y le daría conocimiento INTERNO.
  it('desactiva el Employee si ese teléfono había quedado en la whitelist', async () => {
    employees.findByPhone.mockResolvedValue({ id: 'emp-1', isActive: true });

    await service.setClientFixtures({
      phone,
      fixtures: [ClientFixture.SIN_DEUDA],
    });

    expect(employees.update).toHaveBeenCalledWith(
      'emp-1',
      { isActive: false },
      expect.any(String),
    );
  });

  it('no toca al Employee si ya estaba inactivo', async () => {
    employees.findByPhone.mockResolvedValue({ id: 'emp-1', isActive: false });

    await service.setClientFixtures({
      phone,
      fixtures: [ClientFixture.SIN_DEUDA],
    });

    expect(employees.update).not.toHaveBeenCalled();
  });

  it('limpia el agente sticky de las conversaciones abiertas', async () => {
    await service.setClientFixtures({
      phone,
      fixtures: [ClientFixture.SIN_DEUDA],
    });

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { externalId: phone, status: { not: 'CLOSED' } },
      data: { userType: 'CLIENTE', currentAgent: null, agentLockedAt: null },
    });
  });

  describe('RESET', () => {
    it('borra los comprobantes del cliente y devuelve sus cuotas a PENDING', async () => {
      prisma.paymentProof.deleteMany.mockResolvedValue({ count: 3 });

      await service.setClientFixtures({ phone, fixtures: [ClientFixture.RESET] });

      expect(prisma.paymentProof.deleteMany).toHaveBeenCalledWith({
        where: { quota: { clientId: 'client-1' } },
      });
      expect(prisma.quota.updateMany).toHaveBeenCalledWith({
        where: { clientId: 'client-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          reminderAttempts: 0,
          manualHandlingNote: null,
        }),
      });
    });

    // No las borra: pueden pertenecer a una Financing y romperían el plan.
    it('no borra las cuotas', async () => {
      await service.setClientFixtures({ phone, fixtures: [ClientFixture.RESET] });

      expect(prisma.quota.create).not.toHaveBeenCalled();
    });
  });

  describe('fixtures de deuda', () => {
    it('CUOTA_POR_VENCER crea una cuota PENDING con vencimiento futuro', async () => {
      await service.setClientFixtures({
        phone,
        fixtures: [ClientFixture.CUOTA_POR_VENCER],
      });

      const data = prisma.quota.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ clientId: 'client-1', status: 'PENDING' });
      expect(data.dueDate.getTime()).toBeGreaterThan(Date.now());
    });

    it('CUOTA_VENCIDA crea una cuota OVERDUE con vencimiento pasado', async () => {
      await service.setClientFixtures({
        phone,
        fixtures: [ClientFixture.CUOTA_VENCIDA],
      });

      const data = prisma.quota.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ clientId: 'client-1', status: 'OVERDUE' });
      expect(data.dueDate.getTime()).toBeLessThan(Date.now());
    });

    // Idempotencia: llamar dos veces al endpoint no debe acumular cuotas.
    it('reajusta la cuota existente en vez de crear otra', async () => {
      prisma.quota.findFirst.mockResolvedValue({ id: 'quota-1' });

      await service.setClientFixtures({
        phone,
        fixtures: [ClientFixture.CUOTA_POR_VENCER],
      });

      expect(prisma.quota.create).not.toHaveBeenCalled();
      expect(prisma.quota.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'quota-1' },
          data: expect.objectContaining({ reminderAttempts: 0 }),
        }),
      );
    });

    it('SIN_DEUDA salda las cuotas en vez de borrarlas (hay comprobantes colgando)', async () => {
      await service.setClientFixtures({
        phone,
        fixtures: [ClientFixture.SIN_DEUDA],
      });

      expect(prisma.quota.updateMany).toHaveBeenCalledWith({
        where: { clientId: 'client-1', status: { not: 'PAID' } },
        data: { status: 'PAID' },
      });
      expect(prisma.paymentProof.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('aplica los fixtures en orden: RESET limpia y después se arma el escenario', async () => {
    const result = await service.setClientFixtures({
      phone,
      fixtures: [ClientFixture.RESET, ClientFixture.CUOTA_POR_VENCER],
    });

    const resetCall = prisma.quota.updateMany.mock.invocationCallOrder[0];
    const createCall = prisma.quota.create.mock.invocationCallOrder[0];
    expect(resetCall).toBeLessThan(createCall);
    expect(result.fixtures).toEqual(['RESET', 'CUOTA_POR_VENCER']);
  });
});
