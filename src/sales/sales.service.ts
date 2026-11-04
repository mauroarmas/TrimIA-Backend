import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CREDIT_PORT, CreditPort } from '../ai/integrations/ports/credit.port';
import {
  STOCK_PORT,
  StockPort,
  StockItem,
} from '../ai/integrations/ports/stock.port';
import { PrismaService } from '../database/prisma.service';
import {
  CreditCheckDto,
  CommercialCreditResultDto,
} from './dto/credit-check.dto';
import { CloseSaleDto } from './dto/close-sale.dto';
import { PurchaseRequestStatus } from '@prisma/client';
import { ReviewFinancingDto } from './dto/review-financing.dto';

const financingSelection = {
  id: true,
  productSummary: true,
  amount: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  reviewNote: true,
  client: { select: { id: true, name: true, dni: true, phone: true } },
  reviewedBy: { select: { id: true, name: true } },
  financing: { select: { quotaCount: true, totalAmount: true } },
  creditAssessments: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { verdict: true, reason: true, source: true, createdAt: true },
  },
} as const;

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @Inject(CREDIT_PORT) private readonly creditPort: CreditPort,
    @Inject(STOCK_PORT) private readonly stockPort: StockPort,
    private readonly prisma: PrismaService,
  ) {}

  async listFinancingRequests() {
    return this.prisma.purchaseRequest.findMany({
      where: { modality: 'FINANCED' },
      select: financingSelection,
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewFinancingRequest(
    id: string,
    dto: ReviewFinancingDto,
    reviewerId: string,
  ) {
    const request = await this.prisma.purchaseRequest.findUnique({
      where: { id },
    });
    if (!request || request.modality !== 'FINANCED') {
      throw new NotFoundException('Solicitud de financiación no encontrada');
    }
    if (
      dto.decision === 'APPROVED' &&
      (!request.amount || Number(request.amount) <= 0)
    ) {
      throw new ConflictException(
        'La solicitud debe tener un monto válido mayor a cero antes de aprobarla',
      );
    }
    const result = await this.prisma.purchaseRequest.updateMany({
      where: { id, modality: 'FINANCED', status: 'PENDING_REVIEW' },
      data: {
        status: dto.decision,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: dto.note?.trim() || null,
      },
    });
    if (result.count !== 1)
      throw new ConflictException(
        'La solicitud ya fue resuelta o no está pendiente de revisión',
      );
    return this.prisma.purchaseRequest.findUnique({
      where: { id },
      select: financingSelection,
    });
  }

  /**
   * Consulta crediticia confidencial para ventas (OE-10, RF10).
   * Delega en CreditPort pero omite el rawReport bancario y scoring sensible,
   * devolviendo únicamente el dictamen comercial y las condiciones aplicables.
   */
  async checkCreditCommercial(
    dto: CreditCheckDto,
  ): Promise<CommercialCreditResultDto> {
    this.logger.log(`Verificación crediticia solicitada para DNI: ${dto.dni}`);
    const assessment = await this.creditPort.evaluateCredit({
      dni: dto.dni,
      requestedAmount: dto.amount,
    });

    return {
      verdict: assessment.verdict,
      commercialCondition:
        assessment.commercialCondition ??
        'Sin condiciones comerciales especiales informadas por Administración.',
      evaluatedAt: assessment.assessedAt,
    };
  }

  /**
   * Consulta el catálogo de stock en Paljet para el panel de ventas.
   */
  async getStockCatalog(
    query?: string,
    category?: string,
  ): Promise<StockItem[]> {
    let items = await this.stockPort.listCatalog(category);
    if (query && query.trim().length > 0) {
      const q = query.trim().toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
      );
    }
    return items;
  }

  /**
   * Lista los prospectos generados por el bot o cargados en CRM para contactar.
   */
  async getProspects(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    return this.prisma.prospect.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Registra el cierre de una venta acordada y cargada manualmente en Paljet.
   * TrimIA no escribe en Paljet (RNF-04 / Tarea 6.9), pero audita el cierre y vendedor.
   */
  async closeSale(dto: CloseSaleDto, sellerId: string) {
    this.logger.log(`Cierre de venta registrado por empleado ${sellerId}`);

    // Si viene purchaseRequestId, actualizar la ficha
    if (dto.purchaseRequestId) {
      const pr = await this.prisma.purchaseRequest.findUnique({
        where: { id: dto.purchaseRequestId },
      });
      if (!pr) throw new NotFoundException('Solicitud de compra no encontrada');
      if (pr.modality !== dto.modality) {
        throw new ConflictException(
          'La modalidad del cierre no coincide con la solicitud',
        );
      }
      if (pr.modality === 'FINANCED') {
        if (pr.status !== 'APPROVED') {
          throw new ConflictException(
            'La financiación debe estar aprobada por un supervisor antes de cerrar la venta',
          );
        }
        if (Number(pr.amount) !== dto.finalAmount) {
          throw new ConflictException(
            'El monto del cierre debe coincidir con la financiación aprobada',
          );
        }
      }
      if (pr.modality !== 'FINANCED') {
        await this.prisma.purchaseRequest.update({
          where: { id: dto.purchaseRequestId },
          data: {
            status: PurchaseRequestStatus.APPROVED,
            reviewedById: sellerId,
            reviewedAt: new Date(),
            reviewNote: dto.notes,
            amount: dto.finalAmount,
          },
        });
      }
    }

    // Si viene prospectId, marcar prospecto como VENTA_CERRADA
    if (dto.prospectId) {
      const prospect = await this.prisma.prospect.findUnique({
        where: { id: dto.prospectId },
      });
      if (prospect) {
        await this.prisma.prospect.update({
          where: { id: dto.prospectId },
          data: {
            status: 'VENTA_CERRADA',
            sellerId,
            notes: prospect.notes
              ? `${prospect.notes}\n[CIERRE] ${dto.notes}`
              : `[CIERRE] ${dto.notes}`,
          },
        });
      }
    }

    return {
      success: true,
      closedAt: new Date().toISOString(),
      closedById: sellerId,
    };
  }
}
