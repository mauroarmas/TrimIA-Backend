import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { normalizePhone } from '../common/phone';
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
import { EmployeesService } from '../employees/employees.service';
import { ResolveEscalationDto } from '../escalations/dto/resolve-escalation.dto';
import { DelegateEscalationDto } from '../escalations/dto/delegate-escalation.dto';
import { SaveUnsentDto } from '../escalations/dto/save-unsent.dto';
import { DiscardEscalationDto } from '../escalations/dto/discard-escalation.dto';
import { CorrectionPreviewDto } from '../escalations/dto/correction-preview.dto';
import { ManualReplyDto } from '../conversations/dto/manual-reply.dto';
import { CreateInternalNoteDto } from '../conversations/dto/create-internal-note.dto';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Lo que JwtStrategy deja en `req.user`. El resto de este controller usa `any`;
 * acá hace falta tipado porque el stream necesita `exp` (spec 004, RF-022) y el
 * aislamiento por áreas necesita el id, email e isGeneralSupervisor.
 */
interface AuthenticatedRequest {
  user: {
    id: string;
    email?: string;
    role?: string;
    isGeneralSupervisor?: boolean;
    exp?: number;
  };
}

/**
 * Panel del Supervisor (módulo de gobernanza — entregable E4).
 *
 * - GET /supervisor/conversations → lista paginada de conversaciones (RF13, OE-11)
 * - GET /supervisor/metrics       → métricas agregadas en JSON
 *
 * Todos los endpoints exigen JWT + rol SUPERVISOR, salvo /release.
 */
@ApiTags('supervisor')
@Controller('supervisor')
export class SupervisorController {
  constructor(
    private readonly supervisor: SupervisorService,
    private readonly escalations: EscalationsService,
    private readonly suggestions: EscalationSuggestionService,
    private readonly conversations: ConversationsService,
    private readonly employees: EmployeesService,
    private readonly realtime: RealtimeService,
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
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: ConvStatus,
    @Query('channel') channel?: Channel,
    @Query('userType') userType?: UserType,
    @Query('agentType') agentType?: AgentType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.supervisor.getConversations(
      {
        status,
        channel,
        userType,
        agentType,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
      req.user.id,
    );
  }

  /**
   * GET /supervisor/conversations/:id
   * Detalle completo de una conversación (mensajes, eventos, tokens).
   */
  @Get('conversations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Detalle completo de una conversación' })
  async getConversation(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const detail = await this.supervisor.getConversationDetail(id, req.user.id);
    if (!detail) {
      throw new NotFoundException('Conversación no encontrada');
    }
    return detail;
  }

  /**
   * GET /supervisor/conversations/:id/stream
   * Entrega en tiempo real de cualquier conversación (spec 004, US4).
   */
  @Sse('conversations/:id/stream')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Entrega en tiempo real de cualquier conversación (RF-019)',
    description:
      'El permiso se revalida mientras el stream vive: un supervisor degradado ' +
      'o dado de baja deja de recibir (RF-021). La entrega tampoco sobrevive al ' +
      'token que la abrió (RF-022).',
  })
  async streamConversation(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('after') after?: string,
  ): Promise<Observable<unknown>> {
    const conversation = await this.conversations.findById(id);
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (after) {
      await this.conversations.messagesSince(id, after);
    }

    return this.realtime.sseStreamFor(id, {
      replay: after
        ? () => this.conversations.messagesSince(id, after)
        : undefined,
      revalidate: () => this.stillSupervisor(req.user.id, id),
      expiresAt: req.user.exp,
    });
  }

  /**
   * Revalidación del stream del supervisor (RF-021, CL-9).
   */
  private async stillSupervisor(
    employeeId: string,
    conversationId: string,
  ): Promise<boolean> {
    try {
      const employee = await this.employees.findById(employeeId);
      if (!employee.isActive || employee.role !== 'SUPERVISOR') return false;
      return (await this.conversations.findById(conversationId)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * GET /supervisor/events
   * Lista eventos de orquestación (auditoría / timeline).
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

  /**
   * GET /supervisor/conversations/by-contact/:externalId/timeline
   * Vista unificada de lectura de un mismo contacto en una sola línea de tiempo.
   * Acotado al área supervisada si no es supervisor general.
   */
  @Get('conversations/by-contact/:externalId/timeline')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Mensajes de WhatsApp y web de un mismo contacto (FR-018)',
  })
  async getContactTimeline(
    @Param('externalId') externalId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const allowedAgents = await this.supervisor.resolveAllowedAgents(
      req.user.id,
    );
    const normalized = normalizePhone(externalId);
    const result = await this.conversations.getUnifiedTimeline(normalized);
    if (!result) {
      throw new NotFoundException('No hay conversaciones para ese contacto');
    }

    let conversations = result.conversations;
    let timeline = result.timeline;

    if (allowedAgents !== null) {
      conversations = conversations.filter(
        (c) => c.currentAgent && allowedAgents.includes(c.currentAgent),
      );
      if (conversations.length === 0) {
        throw new NotFoundException(
          'No hay conversaciones para ese contacto en su área supervisada',
        );
      }
      const allowedConvIds = new Set(conversations.map((c) => c.id));
      timeline = timeline.filter((m) => allowedConvIds.has(m.conversationId));
    }

    const employee = await this.employees.findByPhone(normalized);
    return {
      contact: {
        externalId: normalized,
        employee: employee ? { id: employee.id, name: employee.name } : null,
      },
      conversations,
      timeline,
    };
  }

  // ---------------------------------------------------------------------
  // Human-in-the-loop (Sprint 3) — cola de escalados y control manual.
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
  @ApiQuery({ name: 'status', enum: EscalationStatus, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiQuery({
    name: 'soloMios',
    type: Boolean,
    required: false,
    description:
      'Restringe a lo propio: las áreas de quien consulta, lo derivado a esa ' +
      'persona y los casos sin área.',
  })
  getEscalations(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: EscalationStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('soloMios') soloMios?: string,
  ) {
    // Si no es Diego Bazán ni supervisor general, restringir siempre a lo propio
    const esGeneral =
      req.user.email === 'diego.bazan@credimision.com' ||
      req.user.isGeneralSupervisor === true;
    const filtrarSoloMios = esGeneral ? soloMios === 'true' : true;

    return this.escalations.listPending({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      empleadoId: req.user.id,
      soloMios: filtrarSoloMios,
    });
  }

  /** GET /supervisor/escalations/:id — detalle de un caso escalado. */
  @Get('escalations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Detalle de un caso escalado' })
  getEscalation(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.escalations.findById(id, req.user.id);
  }

  /**
   * GET /supervisor/escalations/:id/knowledge-candidates
   */
  @Get('escalations/:id/knowledge-candidates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Documentos que quedaron cortos en un caso, para corregir uno',
  })
  getKnowledgeCandidates(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.escalations.knowledgeCandidates(id, req.user.id);
  }

  /**
   * GET /supervisor/escalations/:id/hygiene-warning
   */
  @Get('escalations/:id/hygiene-warning')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Si los documentos consultados en el caso compiten entre sí',
  })
  getHygieneWarning(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.escalations.hygieneWarning(id, req.user.id);
  }

  /**
   * POST /supervisor/escalations/:id/correction-preview
   */
  @Post('escalations/:id/correction-preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Propone el documento corregido con la respuesta (no guarda nada)',
  })
  previewCorrection(
    @Param('id') id: string,
    @Body() dto: CorrectionPreviewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.escalations.correctionPreview(id, dto, req.user.id);
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
   */
  @Get('escalations/:id/suggestion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary: 'Redacta una propuesta con el conocimiento cargado (FR-034)',
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
   * Estado de los agentes. Acotado a las áreas supervisadas si no es supervisor general.
   */
  @Get('agents/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({
    summary:
      'Estado, cobertura y margen de cada agente sobre la ventana vigente',
  })
  getAgentsStatus(@Req() req: AuthenticatedRequest) {
    return this.supervisor.getAgentsStatus(req.user.id);
  }

  /**
   * GET /supervisor/metrics
   * Métricas agregadas acotadas al área del supervisor.
   */
  @Get('metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @ApiOperation({ summary: 'Métricas agregadas para el Panel del Supervisor' })
  getMetrics(@Req() req: AuthenticatedRequest) {
    return this.supervisor.getMetrics(req.user.id);
  }
}
