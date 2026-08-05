import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { normalizePhone } from '../common/phone';

export interface CreateClientDto {
  name: string;
  phone: string;
  dni?: string;
  assignedCollectorId?: string;
}

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

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
