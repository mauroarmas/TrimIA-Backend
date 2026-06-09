import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupervisorService } from './supervisor.service';
import { DASHBOARD_HTML } from './supervisor-dashboard.html';

/**
 * Panel del Supervisor (módulo de gobernanza — entregable E4).
 *
 * - GET /supervisor          → la página HTML del dashboard (abrir en el navegador).
 * - GET /supervisor/metrics  → los datos en JSON que la página consume.
 *
 * Se llama "supervisor" (no "admin") para NO confundirlo con el agente ADMIN
 * (verificación crediticia). Acá "supervisor" = la persona que gobierna/audita.
 *
 * ⚠️ Sin auth todavía: herramienta interna. Antes de producción hay que
 * protegerla por rol SUPERVISOR. Por eso /metrics NO devuelve contenido de
 * mensajes, solo agregados.
 */
@ApiTags('supervisor')
@Controller('supervisor')
export class SupervisorController {
  constructor(private readonly supervisor: SupervisorService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Métricas agregadas para el Panel del Supervisor' })
  getMetrics() {
    return this.supervisor.getMetrics();
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Página HTML del Panel del Supervisor' })
  dashboard(): string {
    return DASHBOARD_HTML;
  }
}