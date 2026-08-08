import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CRM_PORT } from './crm/crm.port';
import { N8nCrmAdapter } from './crm/n8n-crm.adapter';

@Module({
  providers: [
    ClientsService,
    // El CRM se escribe vía un webhook de n8n (mismo criterio que
    // WhatsappSenderService): el backend no guarda la credencial de Google.
    // Hoy n8n escribe en un Sheets personal de prueba; migrar a la planilla
    // real de la empresa es cambiar la credencial en n8n, no este provider.
    { provide: CRM_PORT, useClass: N8nCrmAdapter },
  ],
  exports: [ClientsService, CRM_PORT],
})
export class ClientsModule {}
