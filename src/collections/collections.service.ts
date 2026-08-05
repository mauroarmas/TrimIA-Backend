import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Panel del cobrador: KPIs, listado de clientes, historial unificado (Sprint 4 — US4).
 */
@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    const messages = await this.prisma.message.findMany({
      where: { conversation: { externalId: client.phone } },
      orderBy: { createdAt: 'desc' },
    });

    const notes = await this.prisma.internalNote.findMany({
      where: { conversation: { externalId: client.phone } },
      orderBy: { createdAt: 'desc' },
    });

    const events = await this.prisma.orchestrationEvent.findMany({
      where: { conversation: { externalId: client.phone } },
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
}
