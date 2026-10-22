import { Inject, Injectable, Logger } from '@nestjs/common';
import { CRM_PORT, CrmPort, CrmProspectRecord, ProspectStatus } from './ports/crm.port';
import { PrismaService } from '../../database/prisma.service';
import { ProspectSyncStatus } from '@prisma/client';

@Injectable()
export class CrmSyncService {
  private readonly logger = new Logger(CrmSyncService.name);

  constructor(
    @Inject(CRM_PORT) private readonly crmPort: CrmPort,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Reintenta sincronizar con Google Sheets (n8n) los prospectos que quedaron
   * en estado PENDING debido a caídas temporales de red o de n8n.
   */
  async syncPendingProspects(): Promise<number> {
    const pendings = await this.prisma.prospect.findMany({
      where: { syncStatus: ProspectSyncStatus.PENDING },
      take: 20,
    });

    if (pendings.length === 0) return 0;

    let syncedCount = 0;
    for (const p of pendings) {
      const record: CrmProspectRecord = {
        fechaContacto: p.createdAt.toLocaleDateString('es-AR'),
        nombreApellido: p.name,
        telefono: p.phone,
        dni: p.dni ?? undefined,
        comercio: p.comercio ?? undefined,
        rubro: p.rubro ?? undefined,
        localidad: p.localidad ?? undefined,
        productoInteres: p.productInterest,
        modalidad: p.modality === 'FINANCED' ? 'CUOTAS_SEMANALES' : 'CONTADO',
        montoEstimado: p.estimatedAmount ? Number(p.estimatedAmount) : undefined,
        estado: (p.status as ProspectStatus) || ProspectStatus.NUEVO,
        canalOrigen: (p.originChannel as any) || 'WHATSAPP',
        ultimaInteraccion: p.updatedAt.toISOString(),
        notasSeguimiento: p.notes || '',
        conversationId: p.conversationId ?? undefined,
      };

      try {
        const res = await this.crmPort.createProspect(record);
        if (res.success) {
          await this.prisma.prospect.update({
            where: { id: p.id },
            data: {
              syncStatus: ProspectSyncStatus.SYNCED,
              lastSyncedAt: new Date(),
            },
          });
          syncedCount++;
        }
      } catch (err: any) {
        this.logger.warn(`Fallo al sincronizar prospecto pendiente ${p.id}: ${err.message}`);
      }
    }

    this.logger.log(`Reintento de sincronización CRM completado: ${syncedCount}/${pendings.length} sincronizados`);
    return syncedCount;
  }
}

