import { NotFoundException } from '@nestjs/common';
import { DevToolsService } from './dev-tools.service';
import { PrismaService } from '../database/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { ClientsService } from '../clients/clients.service';
import { TestPersonaScenario } from './dto/set-test-persona.dto';

/**
 * Tests de DevToolsService: endpoint provisorio para reasignar el único
 * teléfono de prueba cargado en Meta a distintos "roles" del sistema
 * (cliente de Ventas/Cobranzas, cobrador, supervisor) sin editar la DB a
 * mano. Todas las dependencias se mockean.
 */
describe('DevToolsService', () => {
  const phone = '543865505362';

  let service: DevToolsService;
  let prisma: {
    employee: { findFirst: jest.Mock };
    quota: { findFirst: jest.Mock; create: jest.Mock };
    sector: { findUnique: jest.Mock };
    conversation: { updateMany: jest.Mock };
  };
  let employees: {
    findByPhone: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  let clients: { getByPhone: jest.Mock; create: jest.Mock };

  beforeEach(() => {
    prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
      quota: { findFirst: jest.fn(), create: jest.fn() },
      sector: { findUnique: jest.fn() },
      conversation: { updateMany: jest.fn() },
    };
    employees = {
      findByPhone: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
    };
    clients = { getByPhone: jest.fn().mockResolvedValue(null), create: jest.fn() };

    service = new DevToolsService(
      prisma as unknown as PrismaService,
      employees as unknown as EmployeesService,
      clients as unknown as ClientsService,
    );
  });

  describe('CLIENTE_VENTAS', () => {
    it('desactiva un Employee existente para ese teléfono y no toca Client', async () => {
      employees.findByPhone.mockResolvedValue({ id: 'emp-1', isActive: true });

      await service.setTestPersona(phone, TestPersonaScenario.CLIENTE_VENTAS);

      expect(employees.update).toHaveBeenCalledWith(
        'emp-1',
        { isActive: false },
        expect.any(String),
      );
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('resetea userType a CLIENTE y limpia el agente sticky de las conversaciones', async () => {
      await service.setTestPersona(phone, TestPersonaScenario.CLIENTE_VENTAS);

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { externalId: phone, status: { not: 'CLOSED' } },
        data: { userType: 'CLIENTE', currentAgent: null, agentLockedAt: null },
      });
    });
  });

  describe('CLIENTE_COBRANZAS', () => {
    it('crea un Client y una cuota PENDING cuando no existen', async () => {
      clients.create.mockResolvedValue({ id: 'cust-1', phone });

      await service.setTestPersona(phone, TestPersonaScenario.CLIENTE_COBRANZAS);

      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone }),
      );
      expect(prisma.quota.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clientId: 'cust-1', status: 'PENDING' }),
        }),
      );
    });

    it('no crea una cuota nueva si el cliente ya tiene una', async () => {
      clients.getByPhone.mockResolvedValue({ id: 'cust-1', phone });
      prisma.quota.findFirst.mockResolvedValue({ id: 'inst-1' });

      await service.setTestPersona(phone, TestPersonaScenario.CLIENTE_COBRANZAS);

      expect(clients.create).not.toHaveBeenCalled();
      expect(prisma.quota.create).not.toHaveBeenCalled();
    });
  });

  describe('EMPLEADO_COBRADOR', () => {
    it('crea un Employee nuevo en el sector Cobranzas cuando no existe', async () => {
      prisma.sector.findUnique.mockResolvedValue({ id: 'sector-cobranzas' });

      await service.setTestPersona(phone, TestPersonaScenario.EMPLEADO_COBRADOR);

      expect(employees.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phone,
          role: 'EMPLEADO',
          sectorId: 'sector-cobranzas',
        }),
        expect.any(String),
      );
    });

    it('actualiza el rol si el Employee ya existe en vez de duplicarlo', async () => {
      employees.findByPhone.mockResolvedValue({ id: 'emp-1', isActive: false });
      prisma.sector.findUnique.mockResolvedValue({ id: 'sector-cobranzas' });

      await service.setTestPersona(phone, TestPersonaScenario.EMPLEADO_COBRADOR);

      expect(employees.create).not.toHaveBeenCalled();
      expect(employees.update).toHaveBeenCalledWith(
        'emp-1',
        { role: 'EMPLEADO', isActive: true, sectorId: 'sector-cobranzas' },
        expect.any(String),
      );
    });

    it('lanza NotFoundException si el sector Cobranzas no existe (seed no corrido)', async () => {
      prisma.sector.findUnique.mockResolvedValue(null);

      await expect(
        service.setTestPersona(phone, TestPersonaScenario.EMPLEADO_COBRADOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('usa el sector indicado (ej. Ventas) en vez del default Cobranzas', async () => {
      prisma.sector.findUnique.mockResolvedValue({ id: 'sector-ventas' });

      await service.setTestPersona(
        phone,
        TestPersonaScenario.EMPLEADO_COBRADOR,
        'Ventas',
      );

      expect(prisma.sector.findUnique).toHaveBeenCalledWith({
        where: { name: 'Ventas' },
      });
      expect(employees.create).toHaveBeenCalledWith(
        expect.objectContaining({ sectorId: 'sector-ventas' }),
        expect.any(String),
      );
    });

    it('si el Employee ya existe, también actualiza el sector al indicado (no solo el rol)', async () => {
      employees.findByPhone.mockResolvedValue({ id: 'emp-1', isActive: false });
      prisma.sector.findUnique.mockResolvedValue({ id: 'sector-ventas' });

      await service.setTestPersona(
        phone,
        TestPersonaScenario.EMPLEADO_COBRADOR,
        'Ventas',
      );

      expect(employees.update).toHaveBeenCalledWith(
        'emp-1',
        { role: 'EMPLEADO', isActive: true, sectorId: 'sector-ventas' },
        expect.any(String),
      );
    });
  });

  describe('SUPERVISOR', () => {
    it('crea el Employee con rol SUPERVISOR y userType EMPLEADO en la conversación', async () => {
      prisma.sector.findUnique.mockResolvedValue({ id: 'sector-cobranzas' });

      await service.setTestPersona(phone, TestPersonaScenario.SUPERVISOR);

      expect(employees.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'SUPERVISOR' }),
        expect.any(String),
      );
      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { externalId: phone, status: { not: 'CLOSED' } },
        data: { userType: 'EMPLEADO', currentAgent: null, agentLockedAt: null },
      });
    });
  });
});