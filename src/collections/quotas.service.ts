import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';

/**
 * Gestión de cuotas (Sprint 4 — Historia 5: marcar como manejadas manualmente).
 */
@Injectable()
export class QuotasService {
  private readonly logger = new Logger(QuotasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrationLogger: OrchestrationLogger,
  ) {}

  async markManual(
    quotaId: string,
    employeeId: string,
    isController: boolean,
    note?: string,
  ) {
    const quota = await this.prisma.quota.findUnique({
      where: { id: quotaId },
      include: { client: true },
    });

    if (!quota) {
      throw new NotFoundException('Cuota no encontrada');
    }

    if (!isController && quota.client.assignedCollectorId !== employeeId) {
      throw new ForbiddenException(
        'No tenés acceso a esta cuota',
      );
    }

    const updated = await this.prisma.quota.update({
      where: { id: quotaId },
      data: {
        status: 'MANUAL',
        manualHandlingNote: note,
      },
    });

    await this.orchestrationLogger.logEvent({
      eventType: 'quota_marked_manual',
      payload: {
        quotaId,
        markedByEmployeeId: employeeId,
        note,
      },
    });

    this.logger.log(
      `Cuota ${quotaId} marcada como manejada manualmente por ${employeeId}`,
    );

    return updated;
  }
}
