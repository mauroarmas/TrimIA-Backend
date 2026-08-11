import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { normalizePhone } from '../common/phone';
import { CRM_PORT, CrmPort } from './crm/crm.port';

export interface CreateClientDto {
  name: string;
  phone: string;
  dni?: string;
  assignedCollectorId?: string;
}

export interface QuotaPlanItem {
  amount: number;
  dueDate: string | Date;
}

export interface CreateClientWithQuotasDto extends CreateClientDto {
  quotas: QuotaPlanItem[];
}

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CRM_PORT) private readonly crm: CrmPort,
  ) {}

  // El teléfono se normaliza al guardar y al buscar: es la clave por la que
  // se cruza el Cliente con el externalId que manda Meta (ver common/phone.ts).
  async getByPhone(phone: string) {
    return this.prisma.client.findUnique({
      where: { phone: normalizePhone(phone) },
    });
  }

  async create(dto: CreateClientDto) {
    const phone = normalizePhone(dto.phone);

    const existing = await this.prisma.client.findUnique({ where: { phone } });
    if (existing) {
      throw new ConflictException('Ya existe un cliente con ese teléfono');
    }

    return this.prisma.client.create({
      data: {
        name: dto.name,
        phone,
        dni: dto.dni,
        assignedCollectorId: dto.assignedCollectorId,
      },
    });
  }

  /**
   * Alta del cliente junto con su plan de cuotas, en una sola operación
   * atómica (FR-001a / US6). Es el punto del flujo donde nace el cliente: lo
   * hace el vendedor al cerrar la venta por WhatsApp.
   *
   * `assignedCollectorId` puede venir vacío — un cliente sin cobrador es
   * válido y sus casos caen en la cola del Cobrador Controlador (FR-001b).
   *
   * La escritura hacia el CRM es best-effort: si falla, el alta local NO se
   * revierte. Postgres es la fuente de verdad; el Sheets es copia de ida.
   */
  async createWithQuotas(dto: CreateClientWithQuotasDto) {
    const phone = normalizePhone(dto.phone);

    const existing = await this.prisma.client.findUnique({ where: { phone } });
    if (existing) {
      throw new ConflictException('Ya existe un cliente con ese teléfono');
    }

    const client = await this.prisma.client.create({
      data: {
        name: dto.name,
        phone,
        dni: dto.dni,
        assignedCollectorId: dto.assignedCollectorId,
        quotas: {
          create: dto.quotas.map((q) => ({
            amount: q.amount,
            dueDate: new Date(q.dueDate),
          })),
        },
      },
      include: { quotas: { orderBy: { dueDate: 'asc' } } },
    });

    await this.crm
      .upsertClient({
        name: client.name,
        phone: client.phone,
        dni: client.dni,
        quotaCount: client.quotas.length,
      })
      .catch((err) =>
        this.logger.error(
          `Alta de ${client.phone} hecha en Postgres pero NO replicada al CRM: ${err}`,
        ),
      );

    return client;
  }

  async assignCollector(clientId: string, employeeId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return this.prisma.client.update({
      where: { id: clientId },
      data: { assignedCollectorId: employeeId },
    });
  }

  /** Todos los clientes de un cobrador. Sin filtro para isController (ver CollectionsService). */
  async listByCollector(employeeId: string) {
    return this.prisma.client.findMany({
      where: { assignedCollectorId: employeeId },
      orderBy: { name: 'asc' },
    });
  }

  async listAll() {
    return this.prisma.client.findMany({ orderBy: { name: 'asc' } });
  }
}
