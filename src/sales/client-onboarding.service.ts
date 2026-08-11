import { Injectable, Logger } from '@nestjs/common';
import { ClientsService } from '../clients/clients.service';
import { PaymentProofsService } from '../collections/payment-proofs.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { CreateClientDto } from './dto/create-client.dto';

/**
 * Alta de un cliente al cerrar la venta (US6 / FR-001a).
 *
 * Vive en `sales/` y no en `clients/` a propósito: necesita coordinar el alta
 * (ClientsModule) con la recuperación de comprobantes huérfanos
 * (CollectionsModule), y ponerlo en cualquiera de los dos crearía una
 * dependencia circular entre ellos.
 */
@Injectable()
export class ClientOnboardingService {
  private readonly logger = new Logger(ClientOnboardingService.name);

  constructor(
    private readonly clients: ClientsService,
    private readonly paymentProofs: PaymentProofsService,
    private readonly orchestrationLogger: OrchestrationLogger,
  ) {}

  async createClient(dto: CreateClientDto, actorId: string) {
    const client = await this.clients.createWithQuotas(dto);

    await this.orchestrationLogger.logEvent({
      eventType: 'client_created',
      payload: {
        clientId: client.id,
        createdById: actorId,
        quotaCount: client.quotas.length,
        assignedCollectorId: client.assignedCollectorId ?? null,
      },
    });

    // Si este cliente ya nos había mandado un comprobante antes de existir en
    // el sistema, ahora tiene a qué cuota imputarse (FR-006b).
    const recovered = await this.paymentProofs
      .reconcileUnmatchedForPhone(client.phone, client.id)
      .catch((err) => {
        this.logger.error(
          `Alta de ${client.phone} OK, pero falló la recuperación de comprobantes: ${err}`,
        );
        return [];
      });

    return { ...client, recoveredProofs: recovered.length };
  }
}
