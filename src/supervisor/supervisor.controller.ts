import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  AgentType,
  Channel,
  ConvStatus,
  EscalationStatus,
  UserType,
} from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { SupervisorService } from './supervisor.service';
import { EscalationsService } from '../escalations/escalations.service';
import { EscalationSuggestionService } from '../escalations/escalation-suggestion.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ResolveEscalationDto } from '../escalations/dto/resolve-escalation.dto';
import { DelegateEscalationDto } from '../escalations/dto/delegate-escalation.dto';
import { SaveUnsentDto } from '../escalations/dto/save-unsent.dto';
import { DiscardEscalationDto } from '../escalations/dto/discard-escalation.dto';
import { ManualReplyDto } from '../conversations/dto/manual-reply.dto';
import { CreateInternalNoteDto } from '../conversations/dto/create-internal-note.dto';

/**
 * Panel del Supervisor (módulo de gobernanza — entregable E4).
 *
 * - GET /supervisor/conversations → lista paginada de conversaciones (RF13, OE-11)
 * - GET /supervisor/metrics       → métricas agregadas en JSON
 *
 * Todos los endpoints exigen JWT + rol SUPERVISOR, salvo /release (ver el
 * comentario en el propio endpoint). El dashboard HTML de desarrollo que
 * vivía acá (GET /supervisor) se borró: nunca autenticaba su propio fetch a
 * /metrics (exigía Bearer JWT, el fetch no lo mandaba) y ya hay un frontend
 * de pruebas para el Panel del Supervisor (repo trimIA-frontend).
 */
@ApiTags('supervisor')
@Controller('supervisor')
export class SupervisorController {
  constructor(
    private readonly supervisor: SupervisorService,
    private readonly escalations: EscalationsService,
    private readonly suggestions: EscalationSuggestionService,
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
  @ApiQuery({
    name: 'after',
    type: String,
    required: false,
    description: 'Fecha ISO (ej. 2026-07-22T00:00:00Z)',
  })
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

  /**
   * POST /supervisor/conversations/:id/release — devuelve el control.
   *
   * Abierto también a EMPLEADO (no solo SUPERVISOR): un cobrador que tomó
   * la conversación vía markManualHandling (Sprint 4) no tenía ninguna ruta
   * legítima para soltarla — quedaba en HUMAN_HANDLING para siempre, porque
   * este endpoint exigía SUPERVISOR. El service ya sabía resolver esto
   * (asSupervisor=false valida que sea el mismo empleado que la tomó); solo
   * faltaba exponerlo. Un SUPERVISOR sigue pudiendo destrabar cualquier
   * conversación, aunque la haya tomado otro empleado.
   */
  @Post('conversations/:id/release')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR', 'EMPLEADO')
  @ApiOperation({ summary: 'Devuelve el control manual de una conversación' })
  releaseConversation(@Param('id') id: string, @Req() req: any) {
    return this.conversations.release(
      id,
      req.user.id,
      req.user.role === 'SUPERVISOR',
    );
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
  // Sprint 5A: los cuatro estados. El default sigue siendo PENDING, así que
  // la cola del panel no cambia de comportamiento.
  @ApiQuery({ name: 'status', enum: EscalationStatus, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  getEscalations(
    @Query('status') status?: EscalationStatus,
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

  /**
   * GET /supervisor/escalations/:id/suggestion — propuesta de respuesta.
   *
   * No resuelve nada: el caso sigue PENDING y la propuesta se guarda solo para
   * auditoría. Mirar `audienceUsed` en la respuesta — sale del `userType` de
   * la conversación escalada, no del supervisor que consulta (research §12).
   */
  @Get('escalations/:id/suggestion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Redacta una propuesta con el conocimiento cargado (FR-034)',
    description:
      'Devuelve `suggestion: null` con `hasContext: false` cuando no hay ' +
      'contexto suficiente, en vez de redactar sin respaldo (FR-035).',
  })
  suggestEscalationResponse(@Param('id') id: string) {
    return this.suggestions.suggest(id);
  }

  /** POST /supervisor/escalations/:id/save-unsent — aprueba y guarda sin enviar. */
  @Post('escalations/:id/save-unsent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Aprueba la respuesta, la incorpora al RAG y NO la envía (FR-039)',
  })
  saveEscalationUnsent(
    @Param('id') id: string,
    @Body() dto: SaveUnsentDto,
    @Req() req: any,
  ) {
    return this.escalations.saveUnsent(id, dto, req.user.id);
  }

  /** POST /supervisor/escalations/:id/discard — cierra el caso sin responder. */
  @Post('escalations/:id/discard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary:
      'Descarta el caso: sin mensaje y sin incorporar nada al RAG (FR-038)',
  })
  discardEscalation(
    @Param('id') id: string,
    @Body() dto: DiscardEscalationDto,
    @Req() req: any,
  ) {
    return this.escalations.discard(id, dto.reason, req.user.id);
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
}
