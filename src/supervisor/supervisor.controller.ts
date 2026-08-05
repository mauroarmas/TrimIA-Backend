import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AgentType, Channel, ConvStatus, UserType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { SupervisorService } from './supervisor.service';
import { DASHBOARD_HTML } from './supervisor-dashboard.html';
import { EscalationsService } from '../escalations/escalations.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ResolveEscalationDto } from '../escalations/dto/resolve-escalation.dto';
import { DelegateEscalationDto } from '../escalations/dto/delegate-escalation.dto';
import { ManualReplyDto } from '../conversations/dto/manual-reply.dto';
import { CreateInternalNoteDto } from '../conversations/dto/create-internal-note.dto';

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
  constructor(
    private readonly supervisor: SupervisorService,
    private readonly escalations: EscalationsService,
    private readonly conversations: ConversationsService,
  ) {}

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



  // ---------------------------------------------------------------------
  // Human-in-the-loop (Sprint 3) — cola de escalados y control manual.
  // Ver specs/001-human-in-the-loop/contracts/supervisor-api.md.
  // ---------------------------------------------------------------------

  /** POST /supervisor/conversations/:id/takeover — toma el control manual. */
  @Post('conversations/:id/takeover')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Toma el control manual de una conversación' })
  takeoverConversation(@Param('id') id: string, @Req() req: any) {
    return this.conversations.takeover(id, req.user.id);
  }

  /** POST /supervisor/conversations/:id/release — devuelve el control. */
  @Post('conversations/:id/release')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Devuelve el control manual de una conversación' })
  releaseConversation(@Param('id') id: string, @Req() req: any) {
    // Un SUPERVISOR puede destrabar cualquier conversación, aunque la haya
    // tomado un EMPLEADO por otra vía (markManualHandling, Sprint 4) — ver
    // el comentario en ConversationsService.release().
    return this.conversations.release(id, req.user.id, true);
  }

  /** POST /supervisor/conversations/:id/reply — mensaje manual durante el control. */
  @Post('conversations/:id/reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Envía un mensaje manual mientras dura el control' })
  replyConversation(
    @Param('id') id: string,
    @Body() dto: ManualReplyDto,
    @Req() req: any,
  ) {
    return this.conversations.replyManually(id, req.user.id, dto.message);
  }

  /** POST /supervisor/conversations/:id/notes — nota interna, nunca visible para el usuario. */
  @Post('conversations/:id/notes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Agrega una nota interna a una conversación' })
  addInternalNote(
    @Param('id') id: string,
    @Body() dto: CreateInternalNoteDto,
    @Req() req: any,
  ) {
    return this.conversations.addInternalNote(id, req.user.id, dto.content);
  }

  /** GET /supervisor/escalations?status=&page=&limit= — cola de casos pendientes. */
  @Get('escalations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Lista casos escalados (default: pendientes)' })
  @ApiQuery({ name: 'status', enum: ['PENDING', 'RESOLVED'], required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  getEscalations(
    @Query('status') status?: 'PENDING' | 'RESOLVED',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.escalations.listPending({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** GET /supervisor/escalations/:id — detalle de un caso escalado. */
  @Get('escalations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Detalle de un caso escalado' })
  getEscalation(@Param('id') id: string) {
    return this.escalations.findById(id);
  }

  /** POST /supervisor/escalations/:id/resolve — responde el caso al usuario. */
  @Post('escalations/:id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Resuelve un caso escalado y responde al usuario' })
  resolveEscalation(
    @Param('id') id: string,
    @Body() dto: ResolveEscalationDto,
    @Req() req: any,
  ) {
    return this.escalations.resolve(id, dto, req.user.id);
  }

  /** POST /supervisor/escalations/:id/delegate — reasigna el caso a otro supervisor. */
  @Post('escalations/:id/delegate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Delega un caso escalado a otro supervisor' })
  delegateEscalation(
    @Param('id') id: string,
    @Body() dto: DelegateEscalationDto,
    @Req() req: any,
  ) {
    return this.escalations.delegate(id, dto, req.user.id);
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
