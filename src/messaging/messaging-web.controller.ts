import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagingService } from './messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EmployeesService } from '../employees/employees.service';
import { SendWebMessageDto } from './dto/send-web-message.dto';
import { normalizePhone } from '../common/phone';

/** Mismo trap que en KnowledgeController: `req.user.id`, no `req.user.sub`. */
interface AuthenticatedRequest {
  user: { id: string };
}

/**
 * Chat web del panel (Sprint 5A, US4, RF-07).
 *
 * Solo exige sesión válida — **no** `SUPERVISOR`: cualquier empleado
 * autenticado puede conversar con el asistente desde la computadora, igual
 * que puede hacerlo por WhatsApp.
 */
@ApiTags('messaging-web')
@Controller('messaging/web')
@UseGuards(JwtAuthGuard)
export class MessagingWebController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly conversations: ConversationsService,
    private readonly employees: EmployeesService,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Envía un mensaje al asistente desde el panel (FR-015)',
    description:
      'Encola y responde 202 — jamás se ejecuta IA dentro del request ' +
      '(Principio IV), mismo contrato de resiliencia que el webhook de WhatsApp.',
  })
  async send(@Body() dto: SendWebMessageDto, @Req() req: AuthenticatedRequest) {
    const { conversationId } = await this.messaging.enqueueWeb(
      req.user.id,
      dto.message,
    );
    return { queued: true, conversationId };
  }

  @Get(':convId/messages')
  @ApiOperation({ summary: 'Historial de una conversación web (FR-015)' })
  async getMessages(
    @Param('convId', ParseUUIDPipe) convId: string,
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const employee = await this.employees.findById(req.user.id);
    const conversation = await this.conversations.findById(convId);
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    // La pertenencia se decide por teléfono, no por "quién la creó": es el
    // mismo criterio que usa MessageProcessor para resolver el userType, y
    // un SUPERVISOR TAMPOCO entra por acá — para leer conversaciones ajenas
    // está /supervisor/conversations/:id, con su propio control de acceso.
    if (
      !employee.phone ||
      conversation.externalId !== normalizePhone(employee.phone)
    ) {
      throw new ForbiddenException('Esta conversación no te pertenece');
    }

    const messages = await this.conversations.listMessages(convId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return {
      ...messages,
      conversation: {
        id: conversation.id,
        status: conversation.status,
        currentAgent: conversation.currentAgent,
        channel: conversation.channel,
      },
    };
  }
}
