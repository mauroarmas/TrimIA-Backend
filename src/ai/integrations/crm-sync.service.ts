import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CRM_PORT, CrmPort } from './ports/crm.port';
import { PrismaService } from '../../database/prisma.service';
import { localCrmRecord } from './crm-sheet.mapper';

@Injectable()
export class CrmSyncService {
  private readonly logger = new Logger(CrmSyncService.name);
  constructor(
    @Inject(CRM_PORT) private readonly crmPort: CrmPort,
    private readonly prisma: PrismaService,
  ) {}

  async syncPendingProspects(): Promise<number> {
    const pending = await this.prisma.prospect.findMany({
      where: { syncStatus: 'PENDING' },
      take: 20,
      orderBy: { updatedAt: 'asc' },
    });
    let synced = 0;
    for (const local of pending) {
      try {
        const result = await this.crmPort.createProspect(localCrmRecord(local));
        if (result.remoteSynced) synced++;
      } catch {
        this.logger.warn(
          `Prospecto ${local.id} sigue pendiente de sincronización.`,
        );
      }
    }
    return synced;
  }

  async syncAllPendingProspects(): Promise<{
    totalPending: number;
    synced: number;
    failed: number;
    remainingPending: number;
    lastSyncedAt: string | null;
  }> {
    const pending = await this.prisma.prospect.findMany({
      where: { syncStatus: 'PENDING' },
      orderBy: { updatedAt: 'asc' },
    });
    let synced = 0;
    let failed = 0;
    for (const local of pending) {
      try {
        const result = await this.crmPort.createProspect(localCrmRecord(local));
        if (result.remoteSynced) synced++;
        else failed++;
      } catch {
        failed++;
        this.logger.warn(
          `Prospecto ${local.id} sigue pendiente de sincronización tras sync global.`,
        );
      }
    }
    const remainingPending = Math.max(0, pending.length - synced);
    return {
      totalPending: pending.length,
      synced,
      failed,
      remainingPending,
      lastSyncedAt: synced > 0 ? new Date().toISOString() : null,
    };
  }

  async syncProspectById(id: string) {
    const local = await this.prisma.prospect.findUnique({ where: { id } });
    if (!local) throw new NotFoundException('Prospecto no encontrado');
    if (local.syncStatus === 'SYNCED') {
      return {
        prospectId: local.id,
        syncStatus: local.syncStatus,
        remoteSynced: true,
        lastSyncedAt: local.lastSyncedAt
          ? local.lastSyncedAt.toISOString()
          : null,
      };
    }
    let remoteSynced = false;
    try {
      const result = await this.crmPort.createProspect(localCrmRecord(local));
      remoteSynced = !!result.remoteSynced;
    } catch {
      this.logger.warn(
        `Prospecto ${local.id} sigue pendiente de sincronización tras intento manual.`,
      );
    }
    const refreshed = await this.prisma.prospect.findUniqueOrThrow({
      where: { id },
    });
    return {
      prospectId: refreshed.id,
      syncStatus: refreshed.syncStatus,
      remoteSynced,
      lastSyncedAt: refreshed.lastSyncedAt
        ? refreshed.lastSyncedAt.toISOString()
        : null,
    };
  }
}
