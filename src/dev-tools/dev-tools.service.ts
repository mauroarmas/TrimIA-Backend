import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { ClientsService } from '../clients/clients.service';
import { TestPersonaScenario } from './dto/set-test-persona.dto';

const DEV_PASSWORD = 'Dev12345!';
const COBRADOR_SECTOR = 'Cobranzas';
const ACTED_BY = 'dev-tool';

/**
 * Reasigna el único teléfono de prueba cargado en Meta a distintos "roles"
 * del sistema (cliente de Ventas/Cobranzas, cobrador, supervisor) sin editar
 * la DB a mano en cada prueba manual. Solo expuesto vía DevOnlyGuard.
 */
@Injectable()
export class DevToolsService {
  private readonly logger = new Logger(DevToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly clients: ClientsService,
  ) {}

  async setTestPersona(
    phone: string,
    scenario: TestPersonaScenario,
    sector: string = COBRADOR_SECTOR,
  ) {
    switch (scenario) {
      case TestPersonaScenario.CLIENTE_VENTAS:
        await this.deactivateEmployeeIfAny(phone);
        break;
      case TestPersonaScenario.CLIENTE_COBRANZAS:
        await this.deactivateEmployeeIfAny(phone);
        await this.ensureClientWithQuota(phone);
        break;
      case TestPersonaScenario.EMPLEADO_COBRADOR:
        await this.upsertEmployee(phone, 'EMPLEADO', sector);
        break;
      case TestPersonaScenario.SUPERVISOR:
        await this.upsertEmployee(phone, 'SUPERVISOR', sector);
        break;
    }

    const userType =
      scenario === TestPersonaScenario.EMPLEADO_COBRADOR ||
      scenario === TestPersonaScenario.SUPERVISOR
        ? 'EMPLEADO'
        : 'CLIENTE';
    await this.resetConversations(phone, userType);

    this.logger.log(`Persona de prueba "${scenario}" aplicada a ${phone}`);
    return { phone, scenario };
  }

  private async deactivateEmployeeIfAny(phone: string) {
    const employee = await this.employees.findByPhone(phone);
    if (employee) {
      await this.employees.update(employee.id, { isActive: false }, ACTED_BY);
    }
  }

  private async ensureClientWithQuota(phone: string) {
    let client = await this.clients.getByPhone(phone);
    if (!client) {
      const collector = await this.prisma.employee.findFirst({
        where: { isActive: true, sector: { name: COBRADOR_SECTOR } },
      });
      client = await this.clients.create({
        name: `Cliente de prueba (${phone})`,
        phone,
        assignedCollectorId: collector?.id,
      });
    }

    const hasQuota = await this.prisma.quota.findFirst({
      where: { clientId: client.id },
    });
    if (!hasQuota) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3);
      await this.prisma.quota.create({
        data: {
          clientId: client.id,
          amount: 15000,
          dueDate,
          status: 'PENDING',
        },
      });
    }
  }

  private async upsertEmployee(
    phone: string,
    role: 'EMPLEADO' | 'SUPERVISOR',
    sectorName: string,
  ) {
    const sector = await this.prisma.sector.findUnique({
      where: { name: sectorName },
    });
    if (!sector) {
      throw new NotFoundException(
        `Sector "${sectorName}" no existe — corré el seed primero`,
      );
    }

    const existing = await this.employees.findByPhone(phone);
    if (existing) {
      await this.employees.update(
        existing.id,
        { role, isActive: true, sectorId: sector.id },
        ACTED_BY,
      );
      return;
    }

    const digits = phone.replace(/\D/g, '');
    await this.employees.create(
      {
        phone,
        email: `dev-${digits}@trimia.dev`,
        name: `Test ${role} (${phone})`,
        password: DEV_PASSWORD,
        role,
        sectorId: sector.id,
      },
      ACTED_BY,
    );
  }

  private async resetConversations(phone: string, userType: 'CLIENTE' | 'EMPLEADO') {
    await this.prisma.conversation.updateMany({
      where: { externalId: phone, status: { not: 'CLOSED' } },
      data: { userType, currentAgent: null, agentLockedAt: null },
    });
  }
}