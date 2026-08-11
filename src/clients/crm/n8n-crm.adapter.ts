import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrmPort, CrmClientRecord } from './crm.port';

/**
 * Adaptador del puerto de CRM que delega la escritura a n8n, mismo criterio
 * que `WhatsappSenderService`: el backend nunca guarda las credenciales de la
 * integración externa (acá, la cuenta de Google Sheets), solo le pega a un
 * webhook propio de n8n con `N8N_BASE_URL` y n8n hace el trabajo con su propio
 * nodo nativo de Google Sheets (credencial OAuth2 configurada ahí).
 *
 * Etapa actual: el workflow de n8n (`n8n/workflows/CrmUpsertCliente-C.json`)
 * escribe en un Google Sheets de prueba de una cuenta personal, para validar
 * el flujo de punta a punta. Migrar a la planilla real de la empresa es
 * solamente cambiar la credencial OAuth2 y el spreadsheetId en n8n — nada de
 * este código cambia (T049).
 */
@Injectable()
export class N8nCrmAdapter implements CrmPort {
  private readonly logger = new Logger(N8nCrmAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async upsertClient(record: CrmClientRecord): Promise<void> {
    const baseUrl = this.config.get<string>('N8N_BASE_URL');
    const res = await fetch(`${baseUrl}/webhook/crm-upsert-client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: record.name,
        phone: record.phone,
        dni: record.dni ?? '',
        quotaCount: record.quotaCount,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(
        `Falló la escritura al CRM para ${record.phone} (HTTP ${res.status}): ${body.slice(0, 200)}`,
      );
      throw new Error(`CRM upsert failed: HTTP ${res.status}`);
    }
  }
}
