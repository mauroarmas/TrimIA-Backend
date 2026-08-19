import { Injectable, Logger } from '@nestjs/common';
import { QuotaStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { ClientsService } from '../clients/clients.service';
import {
  ClientFixture,
  SetClientFixturesDto,
} from './dto/set-client-fixtures.dto';

const DEFAULT_SECTOR = 'Cobranzas';
const DEMO_QUOTA_AMOUNT = 15000;

/**
 * Deja al cliente de prueba en una situación concreta para poder repetir un
 * flujo de WhatsApp de cero, sin editar la base a mano.
 *
 * En desarrollo hay dos números cargados en Meta y cada uno tiene una
 * identidad fija: el del cliente (el que usa este endpoint) y el del cobrador
 * (`DEV_COLLECTOR_PHONE`, que el seed asigna a un Employee para que reciba las
 * notificaciones de cobranza). El resto de los empleados entra por el portal
 * web. Por eso acá no hay un eje de "rol": el teléfono es siempre un cliente.
 *
 * Solo expuesto vía DevOnlyGuard.
 */
@Injectable()
export class DevToolsService {
  private readonly logger = new Logger(DevToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly clients: ClientsService,
  ) {}

  async setClientFixtures(dto: SetClientFixturesDto) {
    const { phone, fixtures } = dto;

    // Si el número quedó cargado como empleado en alguna prueba vieja, se
    // desactiva: mientras sea el teléfono del cliente no puede resolver a
    // userType=EMPLEADO en el MessageProcessor.
    await this.deactivateEmployeeIfAny(phone);

    const client = await this.ensureClient(phone);
    for (const fixture of fixtures) {
      await this.applyFixture(client.id, fixture);
    }
    await this.resetConversations(phone);

    this.logger.log(`Fixtures aplicados a ${phone}: ${fixtures.join(', ')}`);
    return { phone, clientId: client.id, fixtures };
  }

  private async deactivateEmployeeIfAny(phone: string) {
    const employee = await this.employees.findByPhone(phone);
    if (employee?.isActive) {
      await this.employees.update(employee.id, { isActive: false }, 'dev-tool');
    }
  }

  /** El Client debe existir siempre: es lo que enlaza Conversation.clientId. */
  private async ensureClient(phone: string) {
    const existing = await this.clients.getByPhone(phone);
    if (existing) return existing;

    const collector = await this.prisma.employee.findFirst({
      where: { isActive: true, sector: { name: DEFAULT_SECTOR } },
    });
    return this.clients.create({
      name: `Cliente de prueba (${phone})`,
      phone,
      assignedCollectorId: collector?.id,
    });
  }

  private async applyFixture(clientId: string, fixture: ClientFixture) {
    switch (fixture) {
      case ClientFixture.RESET:
        return this.reset(clientId);
      case ClientFixture.SIN_DEUDA:
        // Se saldan, no se borran: las cuotas pueden tener PaymentProof
        // colgando y borrarlas rompería la FK.
        await this.prisma.quota.updateMany({
          where: { clientId, status: { not: QuotaStatus.PAID } },
          data: { status: QuotaStatus.PAID },
        });
        return;
      case ClientFixture.CUOTA_POR_VENCER:
        return this.ensureQuota(clientId, QuotaStatus.PENDING, 3);
      case ClientFixture.CUOTA_VENCIDA:
        return this.ensureQuota(clientId, QuotaStatus.OVERDUE, -10);
    }
  }

  /**
   * Vuelve al principio del ciclo de cobranza: borra los comprobantes que
   * quedaron de corridas anteriores y devuelve las cuotas a PENDING.
   *
   * No borra las cuotas — pueden pertenecer a una Financing y dejarían el plan
   * incompleto. Las imágenes en storage/ quedan huérfanas a propósito: son
   * archivos de dev y borrarlas no aporta nada.
   */
  private async reset(clientId: string) {
    const { count } = await this.prisma.paymentProof.deleteMany({
      where: { quota: { clientId } },
    });

    await this.prisma.quota.updateMany({
      where: { clientId },
      data: {
        status: QuotaStatus.PENDING,
        reminderAttempts: 0,
        lastReminderAt: null,
        manualHandlingNote: null,
      },
    });

    this.logger.log(`RESET: ${count} comprobantes borrados`);
  }

  /**
   * Idempotente: si ya hay una cuota en ese estado le reajusta el vencimiento
   * y limpia el rastro de recordatorios, en vez de acumular cuotas nuevas en
   * cada llamada al endpoint.
   */
  private async ensureQuota(
    clientId: string,
    status: QuotaStatus,
    daysFromNow: number,
  ) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + daysFromNow);

    const existing = await this.prisma.quota.findFirst({
      where: { clientId, status },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return this.prisma.quota.update({
        where: { id: existing.id },
        data: {
          dueDate,
          reminderAttempts: 0,
          lastReminderAt: null,
          manualHandlingNote: null,
        },
      });
    }

    return this.prisma.quota.create({
      data: { clientId, amount: DEMO_QUOTA_AMOUNT, dueDate, status },
    });
  }

  /** Limpia el agente sticky para que el próximo mensaje se re-clasifique. */
  private async resetConversations(phone: string) {
    await this.prisma.conversation.updateMany({
      where: { externalId: phone, status: { not: 'CLOSED' } },
      data: { userType: 'CLIENTE', currentAgent: null, agentLockedAt: null },
    });
  }
}
