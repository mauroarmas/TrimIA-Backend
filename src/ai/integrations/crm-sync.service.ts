import { Inject, Injectable, Logger } from '@nestjs/common';
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
}
