import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EscalationsService } from '../escalations/escalations.service';

/**
 * Panel del cobrador: KPIs, listado de clientes, historial unificado (Sprint 4 — US4).
 */
@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalations: EscalationsService,
  ) {}

  async getKpis(employeeId: string, isController: boolean) {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const clientFilter = isController ? {} : { assignedCollectorId: employeeId };

    const clientsWithPendingQuotas = await this.prisma.quota.count({
      where: {
        status: { in: ['PENDING', 'AWAITING_CONFIRMATION', 'OVERDUE'] },
        client: clientFilter,
      },
    });

    const proofsToReview = await this.prisma.paymentProof.count({
      where: {
        status: 'PENDING_REVIEW',
        ...(isController
          ? {}
          : {
              quota: { client: clientFilter },
            }),
      },
    });

    const confirmedThisWeek = await this.prisma.paymentProof.count({
      where: {
        status: 'ACCEPTED',
        acceptedAt: { gte: weekAgo },
        ...(isController
          ? {}
          : {
              quota: { client: clientFilter },
            }),
      },
    });

    return {
      clientsWithPendingQuotas,
      proofsToReview,
      confirmedThisWeek,
    };
  }

  /**
   * Lista los empleados del sector Cobranzas, para el selector de
   * "asignar cobrador" del Cobrador Controlador (FR-001b). Devuelve TODOS
   * los del sector, no solo los que ya tienen algún cliente asignado —
   * sin esto, un cobrador recién dado de alta sin clientes todavía era
   * invisible para el selector, que solo podía derivarse de
   * `clients[].assignedCollector`.
   */
  async listCollectors() {
    return this.prisma.employee.findMany({
      where: { sector: { name: 'Cobranzas' }, isActive: true },
      select: { id: true, name: true, isController: true },
      orderBy: { name: 'asc' },
    });
  }

  async listClients(employeeId: string, isController: boolean) {
    return this.prisma.client.findMany({
      where: isController ? {} : { assignedCollectorId: employeeId },
      include: {
        quotas: { orderBy: { dueDate: 'asc' } },
        assignedCollector: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getClientHistory(
    clientId: string,
    employeeId: string,
    isController: boolean,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) {
      throw new ForbiddenException('Cliente no encontrado');
    }

    if (!isController && client.assignedCollectorId !== employeeId) {
      throw new ForbiddenException(
        'No tenés acceso al historial de este cliente',
      );
    }

    // Las tres tablas se filtran por la FK Conversation.clientId, no por
    // `externalId == client.phone`: el cruce por teléfono se rompía si el
    // cliente cambiaba de número y no cubría el canal WEB.
    const conversationFilter = { conversation: { clientId } };

    const messages = await this.prisma.message.findMany({
      where: conversationFilter,
      orderBy: { createdAt: 'desc' },
    });

    const notes = await this.prisma.internalNote.findMany({
      where: conversationFilter,
      orderBy: { createdAt: 'desc' },
    });

    const events = await this.prisma.orchestrationEvent.findMany({
      where: conversationFilter,
      orderBy: { createdAt: 'desc' },
    });

    const combined = [
      ...messages.map((m) => ({
        ...m,
        type: 'message',
        id: m.id,
        createdAt: m.createdAt,
      })),
      ...notes.map((n) => ({
        ...n,
        type: 'internal_note',
        id: n.id,
        createdAt: n.createdAt,
      })),
      ...events.map((e) => ({
        ...e,
        type: 'event',
        id: e.id,
        createdAt: e.createdAt,
      })),
    ];

    combined.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    return combined;
  }

  /**
   * "Registro de Actividad" (prototipo, Fig 7): a diferencia de
   * getClientHistory() (un cliente a la vez), esta es la vista cruzada que
   * describe el prototipo — buscás por cliente o cobrador, filtrás por tipo
   * de evento, sin entrar cliente por cliente. Reusa las mismas tres tablas
   * (Message, InternalNote, OrchestrationEvent) que ya alimentan esa otra
   * vista, solo que sin fijar un `clientId` único.
   *
   * `eventType` pedido explícitamente devuelve SOLO eventos (mensajes y
   * notas no tienen ese campo) — es lo que usa la pantalla "Recordatorios
   * Enviados" del sidebar con `eventType=quota_reminder_sent`, sin necesitar
   * un endpoint separado.
   */
  async listActivity(
    employeeId: string,
    isController: boolean,
    filter: {
      clientId?: string;
      collectorId?: string;
      eventType?: string;
      after?: Date;
      before?: Date;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));

    const clientWhere: Record<string, unknown> = {};
    if (!isController) {
      // Un cobrador común solo ve sus propios clientes — cualquier
      // `collectorId` que mande en la query se ignora, nunca se aplica.
      clientWhere.assignedCollectorId = employeeId;
    } else if (filter.collectorId) {
      clientWhere.assignedCollectorId = filter.collectorId;
    }
    if (filter.clientId) clientWhere.id = filter.clientId;

    const clients = await this.prisma.client.findMany({
      where: clientWhere,
      select: { id: true },
    });
    const clientIds = clients.map((c) => c.id);

    if (clientIds.length === 0) {
      return { data: [], total: 0, page, limit, hasMore: false };
    }

    const conversationFilter = { conversation: { clientId: { in: clientIds } } };
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (filter.after) dateFilter.gte = filter.after;
    if (filter.before) dateFilter.lte = filter.before;
    const createdAtFilter = Object.keys(dateFilter).length
      ? { createdAt: dateFilter }
      : {};

    const clientSelect = {
      conversation: { select: { clientId: true, client: { select: { name: true } } } },
    };

    const messages = filter.eventType
      ? []
      : await this.prisma.message.findMany({
          where: { ...conversationFilter, ...createdAtFilter },
          include: clientSelect,
          orderBy: { createdAt: 'desc' },
        });

    const notes = filter.eventType
      ? []
      : await this.prisma.internalNote.findMany({
          where: { ...conversationFilter, ...createdAtFilter },
          // `author` resuelto por relación, no el authorId crudo — mismo
          // criterio ya aplicado en SupervisorService.getConversationDetail():
          // un uuid sin nombre obliga al frontend a adivinar quién escribió.
          include: { ...clientSelect, author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        });

    const events = await this.prisma.orchestrationEvent.findMany({
      where: {
        ...conversationFilter,
        ...createdAtFilter,
        ...(filter.eventType ? { eventType: filter.eventType } : {}),
      },
      include: clientSelect,
      orderBy: { createdAt: 'desc' },
    });

    const combined = [
      ...messages.map((m) => ({
        id: m.id,
        type: 'message' as const,
        createdAt: m.createdAt,
        clientId: m.conversation.clientId,
        clientName: m.conversation.client?.name ?? null,
        role: m.role,
        content: m.content,
        agentType: m.agentType,
      })),
      ...notes.map((n) => ({
        id: n.id,
        type: 'internal_note' as const,
        createdAt: n.createdAt,
        clientId: n.conversation.clientId,
        clientName: n.conversation.client?.name ?? null,
        author: n.author ? { id: n.author.id, name: n.author.name } : null,
        authorAgentType: n.authorAgentType,
        content: n.content,
      })),
      ...events.map((e) => ({
        id: e.id,
        type: 'event' as const,
        createdAt: e.createdAt,
        clientId: e.conversation?.clientId ?? null,
        clientName: e.conversation?.client?.name ?? null,
        eventType: e.eventType,
        agentType: e.agentType,
        payload: e.payload,
      })),
    ];

    combined.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = combined.length;
    const skip = (page - 1) * limit;
    const data = combined.slice(skip, skip + limit);

    return { data, total, page, limit, hasMore: skip + data.length < total };
  }

  /**
   * "Escalar el caso al supervisor" (prototipo, Fig 3): a diferencia de la
   * derivación automática que hacen los agentes RAG (baja confianza, o el
   * propio agente pide intervención), este es el cobrador escalando a mano
   * un cliente puntual desde el panel — típicamente tras varios intentos de
   * recordatorio sin respuesta.
   *
   * Reusa EscalationsService.create() tal cual, así que hereda la
   * deduplicación (no crea una segunda Escalation PENDING para la misma
   * conversación) y deja la conversación en WAITING_HUMAN. Se bloquea si
   * ya está en HUMAN_HANDLING: `create()` fuerza WAITING_HUMAN sin
   * condición, y hacerlo ahí pisaría a la persona que ya la tiene tomada.
   */
  async escalateClient(
    clientId: string,
    employeeId: string,
    isController: boolean,
    reason: string,
  ) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }
    if (!isController && client.assignedCollectorId !== employeeId) {
      throw new ForbiddenException('No tenés acceso a este cliente');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { clientId, status: { not: 'CLOSED' } },
    });
    if (!conversation) {
      throw new NotFoundException(
        'El cliente no tiene una conversación abierta para escalar',
      );
    }
    if (conversation.status === 'HUMAN_HANDLING') {
      throw new ConflictException(
        'La conversación ya está en manejo manual, no hace falta escalar',
      );
    }

    const escalation = await this.escalations.create({
      conversationId: conversation.id,
      reason,
    });

    this.logger.log(`Cliente ${clientId} escalado a mano por ${employeeId}`);

    return escalation;
  }
}
