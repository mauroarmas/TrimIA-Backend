import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { CrmPort, CrmProspectRecord, ProspectStatus } from '../ports/crm.port';
import { PaymentModality, ProspectSyncStatus } from '@prisma/client';

@Injectable()
export class N8nCrmAdapter implements CrmPort {
  private readonly logger = new Logger(N8nCrmAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async createProspect(record: CrmProspectRecord): Promise<{ success: boolean; id?: string }> {
    const baseUrl = this.config.get<string>('N8N_BASE_URL') || 'http://localhost:5678';
    let syncStatus: ProspectSyncStatus = ProspectSyncStatus.PENDING;
    let externalId: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${baseUrl}/webhook/crm-prospect-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const body: any = await res.json().catch(() => ({}));
        externalId = body.rowId ?? body.id;
        syncStatus = ProspectSyncStatus.SYNCED;
        this.logger.log(`Prospecto sincronizado exitosamente con n8n Google Sheets: ${record.telefono}`);
      } else {
        this.logger.warn(`n8n respondió con error HTTP ${res.status} al crear prospecto para ${record.telefono}`);
      }
    } catch (err: any) {
      this.logger.warn(`Fallback local activado para prospecto ${record.telefono} por fallo en n8n: ${err.message}`);
    }

    // Persistencia local en PostgreSQL garantizando resiliencia (RNF-04)
    const localProspect = await this.prisma.prospect.create({
      data: {
        phone: record.telefono,
        name: record.nombreApellido,
        dni: record.dni,
        comercio: record.comercio,
        rubro: record.rubro,
        localidad: record.localidad,
        productInterest: record.productoInteres,
        modality: record.modalidad === 'CUOTAS_SEMANALES' ? PaymentModality.FINANCED : PaymentModality.CASH,
        estimatedAmount: record.montoEstimado ? record.montoEstimado : null,
        status: record.estado,
        originChannel: record.canalOrigen as any,
        conversationId: record.conversationId,
        notes: record.notasSeguimiento,
        syncStatus,
        lastSyncedAt: syncStatus === ProspectSyncStatus.SYNCED ? new Date() : null,
      },
    });

    return { success: true, id: externalId ?? localProspect.id };
  }

  async searchProspect(phone: string): Promise<CrmProspectRecord | null> {
    const baseUrl = this.config.get<string>('N8N_BASE_URL') || 'http://localhost:5678';

    // 1. Intentar consultar n8n
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${baseUrl}/webhook/crm-prospect-search?phone=${encodeURIComponent(phone)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const body: any = await res.json().catch(() => null);
        if (body && body.found && body.prospect) {
          return body.prospect as CrmProspectRecord;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Búsqueda en n8n falló para ${phone}, consultando base de datos local: ${err.message}`);
    }

    // 2. Fallback a la base de datos local de PostgreSQL
    const local = await this.prisma.prospect.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    if (!local) return null;

    return {
      fechaContacto: local.createdAt.toISOString().slice(0, 10),
      nombreApellido: local.name,
      telefono: local.phone,
      dni: local.dni ?? undefined,
      comercio: local.comercio ?? undefined,
      rubro: local.rubro ?? undefined,
      localidad: local.localidad ?? undefined,
      productoInteres: local.productInterest,
      modalidad: local.modality === PaymentModality.FINANCED ? 'CUOTAS_SEMANALES' : 'CONTADO',
      montoEstimado: local.estimatedAmount ? Number(local.estimatedAmount) : undefined,
      estado: (local.status as ProspectStatus) || ProspectStatus.NUEVO,
      canalOrigen: (local.originChannel as any) || 'WHATSAPP',
      ultimaInteraccion: local.updatedAt.toISOString(),
      notasSeguimiento: local.notes || '',
      conversationId: local.conversationId ?? undefined,
    };
  }

  async addFollowUp(phone: string, note: string, newStatus?: ProspectStatus): Promise<void> {
    const baseUrl = this.config.get<string>('N8N_BASE_URL') || 'http://localhost:5678';

    // Actualizar registro local
    const existing = await this.prisma.prospect.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const updatedNotes = existing.notes
        ? `${existing.notes}\n[${new Date().toISOString()}] ${note}`
        : `[${new Date().toISOString()}] ${note}`;

      await this.prisma.prospect.update({
        where: { id: existing.id },
        data: {
          notes: updatedNotes,
          status: newStatus ?? existing.status,
          updatedAt: new Date(),
        },
      });
    }

    // Notificar a n8n si es posible
    try {
      await fetch(`${baseUrl}/webhook/crm-prospect-followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          note,
          newStatus,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar nota de seguimiento a n8n para ${phone}: ${err.message}`);
    }
  }
}

