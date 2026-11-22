import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { asCommercialFlow } from '../../financing/commercial-flow';

export interface ClientAccountPurchase {
  producto: string;
  fechaCierre: string;
  modalidad: string;
  importeTotal: string;
  entrega?: string;
  costoEnvioAparte?: string;
  cuotas?: {
    total: number;
    pagadas: number;
    pendientes: number;
    proximaCuota?: {
      numero: number | null;
      importe: string;
      vencimiento: string;
      estado: string;
    };
  };
}

export interface ClientAccountSummary {
  cliente: string;
  comprasCerradas: ClientAccountPurchase[];
  cuotasPendientes: {
    numero: number | null;
    importe: string;
    vencimiento: string;
    estado: string;
  }[];
}

const QUOTA_STATUS_LABELS: Record<string, string> = {
  PENDING: 'pendiente',
  OVERDUE: 'vencida',
  AWAITING_CONFIRMATION: 'en revisión de comprobante',
  PAID: 'pagada',
  MANUAL: 'gestionada manualmente',
};

const formatArs = (value: string | number | null | undefined) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'a confirmar';
  return num.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
  });
};

/**
 * Lectura de compras cerradas, planes de financiación y cuotas del cliente
 * desde PostgreSQL (fuente de verdad local de TrimIA).
 *
 * El cliente se resuelve EXCLUSIVAMENTE a partir del `conversationId` del hilo
 * persistido, nunca desde argumentos generados por el LLM.
 */
@Injectable()
export class ClientAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccountSummary(
    conversationId: string | null,
  ): Promise<ClientAccountSummary | null> {
    if (!conversationId) return null;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        clientId: true,
        externalId: true,
        userType: true,
      },
    });

    if (!conversation || conversation.userType !== 'CLIENTE') return null;

    const client = conversation.clientId
      ? await this.prisma.client.findUnique({
          where: { id: conversation.clientId },
          select: { id: true, name: true },
        })
      : await this.prisma.client.findUnique({
          where: { phone: conversation.externalId },
          select: { id: true, name: true },
        });

    if (!client) return null;

    const [closedRequests, openQuotas] = await Promise.all([
      this.prisma.purchaseRequest.findMany({
        where: {
          clientId: client.id,
          closedAt: { not: null },
        },
        orderBy: { closedAt: 'desc' },
        take: 5,
        include: {
          financing: {
            include: {
              quotas: { orderBy: { number: 'asc' } },
            },
          },
        },
      }),
      this.prisma.quota.findMany({
        where: {
          clientId: client.id,
          status: { in: ['PENDING', 'OVERDUE', 'AWAITING_CONFIRMATION'] },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
    ]);

    if (closedRequests.length === 0 && openQuotas.length === 0) return null;

    const comprasCerradas: ClientAccountPurchase[] = closedRequests.map(
      (req) => {
        const flow = asCommercialFlow(req.commercialFlow);
        const selectedOffer = flow?.offers.find(
          (o) => o.id === flow.selectedOfferId,
        );

        const modalidad =
          selectedOffer?.label ??
          (req.modality === 'CASH' ? 'Contado' : 'Financiado');

        const rawTotal =
          selectedOffer?.total ??
          req.financing?.totalAmount?.toString() ??
          req.amount?.toString();

        const entrega =
          flow?.deliveryMode === 'PICKUP'
            ? 'Retiro en sucursal (sin costo de envío)'
            : flow?.deliveryMode === 'SHIPPING'
              ? `Envío a ${flow.deliveryAddress || 'domicilio'}`
              : undefined;

        const costoEnvioAparte =
          flow?.deliveryMode === 'SHIPPING' &&
          flow.shippingCost &&
          Number(flow.shippingCost) > 0
            ? formatArs(flow.shippingCost)
            : undefined;

        let cuotas: ClientAccountPurchase['cuotas'];
        if (req.financing && req.financing.quotas.length > 0) {
          const paidCount = req.financing.quotas.filter(
            (q) => q.status === 'PAID',
          ).length;
          const pendingList = req.financing.quotas.filter(
            (q) =>
              q.status === 'PENDING' ||
              q.status === 'OVERDUE' ||
              q.status === 'AWAITING_CONFIRMATION',
          );
          const next = pendingList[0];
          cuotas = {
            total: req.financing.quotaCount,
            pagadas: paidCount,
            pendientes: pendingList.length,
            ...(next
              ? {
                  proximaCuota: {
                    numero: next.number,
                    importe: formatArs(next.amount.toString()),
                    vencimiento: next.dueDate.toISOString().slice(0, 10),
                    estado: QUOTA_STATUS_LABELS[next.status] ?? next.status,
                  },
                }
              : {}),
          };
        }

        return {
          producto: req.productSummary,
          fechaCierre: req.closedAt!.toISOString().slice(0, 10),
          modalidad,
          importeTotal: formatArs(rawTotal),
          ...(entrega ? { entrega } : {}),
          ...(costoEnvioAparte ? { costoEnvioAparte } : {}),
          ...(cuotas ? { cuotas } : {}),
        };
      },
    );

    const cuotasPendientes = openQuotas.map((q) => ({
      numero: q.number,
      importe: formatArs(q.amount.toString()),
      vencimiento: q.dueDate.toISOString().slice(0, 10),
      estado: QUOTA_STATUS_LABELS[q.status] ?? q.status,
    }));

    return {
      cliente: client.name,
      comprasCerradas,
      cuotasPendientes,
    };
  }
}
