import {
  ConflictException,
  BadRequestException,
  Optional,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AdministrativeCreditService } from '../ai/integrations/administrative-credit.service';
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
import {
  CRM_PORT,
  CrmPort,
  ProspectStatus,
} from '../ai/integrations/ports/crm.port';
import { ConversationsService } from '../conversations/conversations.service';
import { salesHandoffSchema } from '../ai/agents/sales/sales-handoff.schema';
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
    private readonly administrativeCredit: AdministrativeCreditService,
    @Inject(STOCK_PORT) private readonly stockPort: StockPort,
    private readonly prisma: PrismaService,
    @Optional() @Inject(CRM_PORT) private readonly crm?: CrmPort,
    @Optional() private readonly conversations?: ConversationsService,
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
    return this.administrativeCredit.commercial({
      dni: dto.dni,
      requestedAmount: dto.amount,
    });
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
    const where: any = { status: { notIn: ['VENTA_CERRADA', 'PERDIDO'] } };
    if (status) {
      where.status = status;
    }

    const prospects = await this.prisma.prospect.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const ids = prospects.map((p) => p.conversationId).filter(Boolean);
    const notes = ids.length
      ? await this.prisma.internalNote.findMany({
          where: { conversationId: { in: ids }, authorAgentType: 'SALES' },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    return prospects.map((p) => {
      let handoff = null;
      for (const note of notes.filter(
        (n) => n.conversationId === p.conversationId,
      )) {
        try {
          const data = JSON.parse(note.content);
          const parsed = salesHandoffSchema.safeParse(data);
          if (data.type === 'SALES_HANDOFF' && parsed.success) {
            handoff = parsed.data;
            break;
          }
        } catch {}
      }
      return { ...p, handoff };
    });
  }

  /**
   * Registra el cierre de una venta acordada y cargada manualmente en Paljet.
   * TrimIA no escribe en Paljet (RNF-04 / Tarea 6.9), pero audita el cierre y vendedor.
   */
  async closeSale(dto: CloseSaleDto, sellerId: string) {
    if (
      (!dto.prospectId && !dto.purchaseRequestId) ||
      !Number.isFinite(dto.finalAmount) ||
      dto.finalAmount <= 0 ||
      !dto.notes?.trim()
    )
      throw new BadRequestException(
        'Indicá un prospecto o solicitud, monto positivo y comprobante de cierre.',
      );
    return this.prisma.$transaction(async (tx) => {
      const prospect = dto.prospectId
        ? await tx.prospect.findUnique({ where: { id: dto.prospectId } })
        : null;
      const request = dto.purchaseRequestId
        ? await tx.purchaseRequest.findUnique({
            where: { id: dto.purchaseRequestId },
          })
        : null;
      if (dto.prospectId && !prospect)
        throw new NotFoundException('Prospecto no encontrado');
      if (dto.purchaseRequestId && !request)
        throw new NotFoundException('Solicitud de compra no encontrada');
      if (request) {
        if (request.modality !== dto.modality)
          throw new ConflictException(
            'La modalidad del cierre no coincide con la solicitud',
          );
        if (request.modality === 'FINANCED') {
          if (request.status !== 'APPROVED')
            throw new ConflictException(
              'La financiación debe estar aprobada por un supervisor antes de cerrar la venta',
            );
          if (Number(request.amount) !== dto.finalAmount)
            throw new ConflictException(
              'El monto del cierre debe coincidir con la financiación aprobada',
            );
        }
      }
      const existing = prospect?.closedAt
        ? { closedAt: prospect.closedAt, closedById: prospect.sellerId }
        : request?.closedAt
          ? { closedAt: request.closedAt, closedById: request.closedById }
          : null;
      if (existing) {
        if ((prospect && !prospect.closedAt) || (request && !request.closedAt))
          throw new ConflictException(
            'Uno de los destinos ya fue cerrado. Revisá los registros antes de vincular otro.',
          );
        return {
          success: true,
          closedAt: existing.closedAt.toISOString(),
          closedById: existing.closedById,
        };
      }
      const closedAt = new Date();
      if (prospect) {
        const claimed = await tx.prospect.updateMany({
          where: { id: prospect.id, closedAt: null },
          data: {
            status: 'VENTA_CERRADA',
            closedAt,
            sellerId,
            estimatedAmount: dto.finalAmount,
            modality: dto.modality,
            notes: [prospect.notes, '[CIERRE] ' + dto.notes.trim()]
              .filter(Boolean)
              .join('\n'),
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            'Otro empleado registró el cierre. Volvé a cargarlo.',
          );
      }
      if (request) {
        const claimed = await tx.purchaseRequest.updateMany({
          where: { id: request.id, closedAt: null, status: request.status },
          data: {
            closedAt,
            closedById: sellerId,
            ...(request.modality === 'CASH'
              ? {
                  status: PurchaseRequestStatus.APPROVED,
                  amount: dto.finalAmount,
                  reviewNote: dto.notes.trim(),
                }
              : {}),
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            'La solicitud cambió mientras registrabas el cierre.',
          );
      }
      return {
        success: true,
        closedAt: closedAt.toISOString(),
        closedById: sellerId,
      };
    });
  }

  private async contactProspect(id: string) {
    const prospect = await this.prisma.prospect.findUnique({ where: { id } });
    if (!prospect) throw new NotFoundException('Prospecto no encontrado');
    if (!prospect.conversationId)
      throw new ConflictException(
        'El prospecto todavía no tiene conversación en TrimIA.',
      );
    return prospect;
  }
  async followUp(id: string, note: string) {
    const prospect = await this.prisma.prospect.findUnique({ where: { id } });
    if (!prospect) throw new NotFoundException('Prospecto no encontrado');
    if (!note?.trim())
      throw new BadRequestException(
        'El seguimiento comercial no puede estar vacío.',
      );
    await this.crm.addFollowUp(
      prospect.phone,
      note.trim(),
      ProspectStatus.EN_CONTACTO,
      prospect.id,
    );
    return this.prisma.prospect.findUnique({ where: { id } });
  }
  async getProspectConversation(id: string) {
    const prospect = await this.contactProspect(id);
    const conversation = await this.conversations.findById(
      prospect.conversationId,
    );
    if (!conversation)
      throw new NotFoundException('Conversación no encontrada');
    const messages = await this.conversations.listMessages(conversation.id, {
      limit: 100,
    });
    return { ...conversation, messages: messages.data };
  }
  async takeProspect(id: string, sellerId: string) {
    const prospect = await this.contactProspect(id);
    const conversation = await this.conversations.takeover(
      prospect.conversationId,
      sellerId,
    );
    await this.prisma.prospect.update({
      where: { id },
      data: { sellerId, status: 'EN_CONTACTO' },
    });
    return conversation;
  }
  async replyProspect(id: string, sellerId: string, message: string) {
    const prospect = await this.contactProspect(id);
    return this.conversations.replyManually(
      prospect.conversationId,
      sellerId,
      message,
    );
  }
  async releaseProspect(id: string, sellerId: string) {
    const prospect = await this.contactProspect(id);
    return this.conversations.release(prospect.conversationId, sellerId);
  }
}
