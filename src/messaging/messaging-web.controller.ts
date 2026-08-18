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
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Conversation } from '@prisma/client';
import { Observable } from 'rxjs';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagingService } from './messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EmployeesService } from '../employees/employees.service';
import { SendWebMessageDto } from './dto/send-web-message.dto';
import { normalizePhone } from '../common/phone';
import { RealtimeService } from '../realtime/realtime.service';

/** Mismo trap que en KnowledgeController: `req.user.id`, no `req.user.sub`. */
interface AuthenticatedRequest {
  /** `exp` es el vencimiento del token (segundos epoch), ver JwtStrategy. */
  user: { id: string; exp?: number };
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
    private readonly realtime: RealtimeService,
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
    @Query('after') after?: string,
  ) {
    const conversation = await this.assertOwnership(convId, req.user.id);

    const messages = await this.conversations.listMessages(convId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      after,
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

  /**
   * Entrega en tiempo real del chat propio (spec 004, US1).
   *
   * Es una ruta HTTP normal con `@Sse()`, y eso es justamente el motivo por el que
   * se eligió SSE sobre WebSocket: `JwtAuthGuard` sigue aplicando sin tocar nada y
   * el chequeo de pertenencia se reusa **verbatim**, en vez de escribir un camino
   * de autorización paralelo (research §2).
   *
   * El handler es `async` a propósito: NestJS espera la promesa **antes** de
   * escribir los headers de la respuesta, así que un `403` o un `404` sale como un
   * error HTTP común y no como un stream que se abre y nunca emite (RF-014).
   */
  @Sse(':convId/stream')
  @ApiOperation({
    summary: 'Entrega en tiempo real de una conversación web (RF-001)',
    description:
      'Misma autorización que el historial: un SUPERVISOR tampoco entra por ' +
      'acá (RN-2). El permiso se revalida mientras el stream vive y la entrega ' +
      'no sobrevive al token que la abrió (RF-021, RF-022).',
  })
  async stream(
    @Param('convId', ParseUUIDPipe) convId: string,
    @Req() req: AuthenticatedRequest,
    @Query('after') after?: string,
  ): Promise<Observable<unknown>> {
    await this.assertOwnership(convId, req.user.id);

    // El cursor se valida ACÁ, antes de abrir el stream, para que uno inválido
    // salga como 404 y no como un evento de error dentro de un stream ya abierto
    // (los headers ya estarían escritos). La lectura de verdad va en el thunk,
    // que corre después de conectarse al vivo — ver RealtimeService.sseStreamFor.
    if (after) {
      await this.conversations.messagesSince(convId, after);
    }

    return this.realtime.sseStreamFor(convId, {
      replay: after
        ? () => this.conversations.messagesSince(convId, after)
        : undefined,
      // Los guards corren una sola vez, al abrir. Un stream vive horas, así que
      // sin esto una conexión abierta sobreviviría al permiso que la habilitó:
      // a un empleado dado de baja le seguirían llegando mensajes (CL-9).
      revalidate: () => this.ownsConversation(convId, req.user.id),
      expiresAt: req.user.exp,
    });
  }

  /**
   * Único lugar donde se decide si esta conversación es de quien pregunta.
   *
   * La pertenencia se decide por teléfono, no por "quién la creó": es el mismo
   * criterio que usa MessageProcessor para resolver el userType, y un SUPERVISOR
   * TAMPOCO entra por acá — para leer conversaciones ajenas está
   * /supervisor/conversations/:id, con su propio control de acceso.
   */
  private async assertOwnership(
    convId: string,
    employeeId: string,
  ): Promise<Conversation> {
    const employee = await this.employees.findById(employeeId);
    const conversation = await this.conversations.findById(convId);
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (
      !employee.phone ||
      conversation.externalId !== normalizePhone(employee.phone)
    ) {
      throw new ForbiddenException('Esta conversación no te pertenece');
    }
    return conversation;
  }

  /** La misma regla que `assertOwnership`, en forma de booleano para revalidar. */
  private async ownsConversation(
    convId: string,
    employeeId: string,
  ): Promise<boolean> {
    try {
      await this.assertOwnership(convId, employeeId);
      return true;
    } catch {
      // Cualquier motivo por el que ya no se pueda leer —conversación borrada,
      // empleado dado de baja, teléfono cambiado— cierra la entrega.
      return false;
    }
  }
}
