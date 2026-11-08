import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { CrmPort, CrmProspectRecord, ProspectStatus } from '../ports/crm.port';
import { toCrmSheet, fromCrmSheet, localCrmRecord } from '../crm-sheet.mapper';

@Injectable()
export class N8nCrmAdapter implements CrmPort {
  private readonly logger = new Logger(N8nCrmAdapter.name);
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private async request(route: string, body?: unknown) {
    const url = this.config.get<string>('N8N_BASE_URL');
    if (!url) throw new Error('CRM no configurado');
    const res = await fetch(`${url}/webhook/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-n8n-secret': this.config.get<string>('N8N_WEBHOOK_SECRET')!,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`CRM HTTP ${res.status}`);
    return res.json();
  }

  private async sync(
    local: any,
    route = 'crm-prospect-create',
  ): Promise<boolean> {
    try {
      const result = await this.request(route, {
        row: toCrmSheet(localCrmRecord(local)),
      });
      if (result?.success !== true)
        throw new Error('El CRM no confirmó la escritura');
      // Una edición local concurrente mantiene PENDING y se reenviará completa.
      const updated = await this.prisma.prospect.updateMany({
        where: {
          id: local.id,
          updatedAt: local.updatedAt,
          syncStatus: 'PENDING',
        },
        data: { syncStatus: 'SYNCED', lastSyncedAt: new Date() },
      });
      return updated.count === 1;
    } catch {
      this.logger.warn(
        `Prospecto ${local.id} conservado localmente, pendiente de sincronización CRM.`,
      );
      return false;
    }
  }

  async createProspect(
    record: CrmProspectRecord,
  ): Promise<{ success: boolean; id: string; remoteSynced: boolean }> {
    const local = record.localId
      ? await this.prisma.prospect.findUnique({ where: { id: record.localId } })
      : await this.prisma.prospect.create({
          data: {
            phone: record.telefono,
            name: record.nombreApellido,
            dni: record.dni,
            comercio: record.comercio,
            rubro: record.rubro,
            localidad: record.localidad,
            productInterest: record.productoInteres,
            modality:
              record.modalidad === 'CUOTAS_SEMANALES' ? 'FINANCED' : 'CASH',
            estimatedAmount: record.montoEstimado ?? null,
            status: record.estado,
            originChannel: ['WHATSAPP', 'WEB'].includes(record.canalOrigen)
              ? (record.canalOrigen as any)
              : 'WEB',
            conversationId: record.conversationId,
            notes: record.notasSeguimiento,
            syncStatus: 'PENDING',
            crmData: JSON.parse(
              JSON.stringify({ ...record, sheet: toCrmSheet(record) }),
            ),
          },
        });
    if (!local) throw new NotFoundException('Prospecto no encontrado');
    if (local.syncStatus === 'SYNCED')
      return { success: true, id: local.id, remoteSynced: true };
    return {
      success: true,
      id: local.id,
      remoteSynced: await this.sync(local),
    };
  }

  async searchProspect(phone: string): Promise<CrmProspectRecord | null> {
    const local = await this.prisma.prospect.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (local) return localCrmRecord(local);
    try {
      const result = await this.request(
        'crm-prospect-search?phone=' + encodeURIComponent(phone),
      );
      if (!result?.found || !result.prospect) return null;
      const record = fromCrmSheet(result.prospect);
      if (record.telefono !== phone) return null;
      // Se conserva la fila encontrada para continuar localmente, sin escribirla de vuelta al buscar.
      const saved = await this.prisma.prospect.create({
        data: {
          phone,
          name: record.nombreApellido,
          comercio: record.comercio,
          rubro: record.rubro,
          localidad: record.localidad,
          productInterest: record.productoInteres,
          modality:
            record.modalidad === 'CUOTAS_SEMANALES' ? 'FINANCED' : 'CASH',
          status: record.estado,
          originChannel: 'WHATSAPP',
          notes: record.notasSeguimiento,
          crmData: JSON.parse(JSON.stringify(record)),
          syncStatus: 'SYNCED',
          lastSyncedAt: new Date(),
        },
      });
      return { ...record, localId: saved.id };
    } catch {
      return null;
    }
  }

  async addFollowUp(
    phone: string,
    note: string,
    newStatus?: ProspectStatus,
    localId?: string,
  ): Promise<void> {
    const existing = localId
      ? await this.prisma.prospect.findUnique({ where: { id: localId } })
      : await this.prisma.prospect.findFirst({
          where: { phone },
          orderBy: { createdAt: 'desc' },
        });
    if (!existing || existing.phone !== phone)
      throw new NotFoundException('Prospecto no encontrado');
    const now = new Date();
    const notes = [existing.notes, `[${now.toISOString()}] ${note.trim()}`]
      .filter(Boolean)
      .join('\n');
    const record = localCrmRecord(existing);
    const sheet = toCrmSheet(record);
    sheet.Seguimiento = notes;
    sheet['Fecha último contacto'] = now.toISOString();
    if (newStatus === ProspectStatus.VENTA_CERRADA)
      sheet['Consulta/Venta'] = 'Venta';
    const local = await this.prisma.prospect.update({
      where: { id: existing.id },
      data: {
        notes,
        status: newStatus ?? existing.status,
        crmData: JSON.parse(JSON.stringify({ ...record, sheet })),
        syncStatus: 'PENDING',
      },
    });
    await this.sync(local, 'crm-prospect-followup');
  }
}
