import { Controller, Get, Header, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AgentType, Channel, ConvStatus, UserType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { SupervisorService } from './supervisor.service';
import { DASHBOARD_HTML } from './supervisor-dashboard.html';

/**
 * Panel del Supervisor (módulo de gobernanza — entregable E4).
 *
 * - GET /supervisor/conversations → lista paginada de conversaciones (RF13, OE-11)
 * - GET /supervisor/metrics       → métricas agregadas en JSON
 * - GET /supervisor               → la página HTML del dashboard (dev)
 *
 * Todos los endpoints de datos exigen JWT + rol SUPERVISOR.
 */
@ApiTags('supervisor')
@Controller('supervisor')
export class SupervisorController {
  constructor(private readonly supervisor: SupervisorService) {}

  /**
   * GET /supervisor/conversations
   * Query params: status, channel, userType, agentType, page, limit
   */
  @Get('conversations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Lista paginada de conversaciones' })
  @ApiQuery({ name: 'status', enum: ConvStatus, required: false })
  @ApiQuery({ name: 'channel', enum: Channel, required: false })
  @ApiQuery({ name: 'userType', enum: UserType, required: false })
  @ApiQuery({ name: 'agentType', enum: AgentType, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  getConversations(
    @Query('status') status?: ConvStatus,
    @Query('channel') channel?: Channel,
    @Query('userType') userType?: UserType,
    @Query('agentType') agentType?: AgentType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.supervisor.getConversations({
      status,
      channel,
      userType,
      agentType,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * GET /supervisor/conversations/:id
   * Detalle completo de una conversación (mensajes, eventos, tokens).
   */
  @Get('conversations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Detalle completo de una conversación' })
  async getConversation(@Param('id') id: string) {
    const detail = await this.supervisor.getConversationDetail(id);
    if (!detail) {
      throw new NotFoundException('Conversación no encontrada');
    }
    return detail;
  }

  /**
   * GET /supervisor/events
   * Lista eventos de orquestación (auditoría / timeline).
   * Query params: conversationId, eventType, agentType, after, page, limit
   */
  @Get('events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Lista eventos de orquestación' })
  @ApiQuery({ name: 'conversationId', type: String, required: false })
  @ApiQuery({ name: 'eventType', type: String, required: false })
  @ApiQuery({ name: 'agentType', enum: AgentType, required: false })
  @ApiQuery({ name: 'after', type: String, required: false, description: 'Fecha ISO (ej. 2026-07-22T00:00:00Z)' })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  getEvents(
    @Query('conversationId') conversationId?: string,
    @Query('eventType') eventType?: string,
    @Query('agentType') agentType?: AgentType,
    @Query('after') after?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.supervisor.getEvents({
      conversationId,
      eventType,
      agentType,
      after: after ? new Date(after) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }



  /**
   * GET /supervisor/agents/status
   * Estado de los 5 agentes: conversaciones, confianza RAG promedio y escalados.
   */
  @Get('agents/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Estado y confianza promedio de cada agente' })
  getAgentsStatus() {
    return this.supervisor.getAgentsStatus();
  }

  @Get('metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Métricas agregadas para el Panel del Supervisor' })
  getMetrics() {
    return this.supervisor.getMetrics();
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Página HTML del Panel del Supervisor (dev)' })
  dashboard(): string {
    return DASHBOARD_HTML;
  }
}
