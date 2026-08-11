import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface UpdateReminderConfigDto {
  daysBefore?: number[];
  maxAttempts?: number;
  templateName?: string;
  templateApproved?: boolean;
}

/**
 * ReminderConfig es una fila única (sin multi-tenant en este sprint).
 * get() la crea con defaults si todavía no existe ninguna.
 */
@Injectable()
export class ReminderConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const existing = await this.prisma.reminderConfig.findFirst();
    if (existing) return existing;
    return this.prisma.reminderConfig.create({ data: {} });
  }

  async update(dto: UpdateReminderConfigDto) {
    const current = await this.get();
    return this.prisma.reminderConfig.update({
      where: { id: current.id },
      data: dto,
    });
  }
}
