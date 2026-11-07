import { FinancingService } from '../financing/financing.service';
import { FinancingNoticeService } from '../financing/financing-notice.service';
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
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import { ReviewFinancingDto } from './dto/review-financing.dto';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly administrativeCredit: AdministrativeCreditService,
    @Inject(STOCK_PORT) private readonly stockPort: StockPort,
    private readonly prisma: PrismaService,
    @Optional() @Inject(CRM_PORT) private readonly crm?: CrmPort,
    @Optional() private readonly conversations?: ConversationsService,
    @Optional() private readonly finance?: FinancingService,
    @Optional() private readonly financeNotices?: FinancingNoticeService,
  ) {}

  async listFinancingRequests() {
    return this.finance!.list();
  }
  async reviewFinancingRequest(
    id: string,
    dto: ReviewFinancingDto,
    reviewerId: string,
  ) {
    return this.finance!.review(id, dto, reviewerId);
  }
  getFinancingRequest(id: string) {
    return this.finance!.detail(id);
  }
  createFinancingPlan(
    id: string,
    dto: import('../financing/dto/create-financing-plan.dto').CreateFinancingPlanDto,
    actorId: string,
  ) {
    return this.finance!.createPlan(id, dto, actorId);
  }
  getFinancingDraft(id: string) {
    return this.finance!.getDraft(id);
  }
  completeFinancingDraft(id: string, dto: any, actorId: string) {
    return this.finance!.updateDraft(id, dto, actorId);
  }
  correctFinancingRequest(id: string, dto: any, actorId: string) {
    return this.finance!.correct(id, dto, actorId);
  }
  cancelFinancingRequest(id: string, dto: any, actorId: string) {
    return this.finance!.cancel(id, dto, actorId);
  }
  retryFinancingNotice(id: string, version: number, actorId: string) {
    return this.financeNotices!.retry(id, version, actorId);
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
      const request = dto.purchaseRequestId
        ? await tx.purchaseRequest.findUnique({
            where: { id: dto.purchaseRequestId },
          })
        : null;
      if (
        request?.prospectId &&
        dto.prospectId &&
        request.prospectId !== dto.prospectId
      )
        throw new ConflictException(
          'La oportunidad no corresponde a esta solicitud.',
        );
      const prospectId = dto.prospectId ?? request?.prospectId;
      const prospect = prospectId
        ? await tx.prospect.findUnique({ where: { id: prospectId } })
        : null;
      if (prospectId && !prospect)
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
      if (
        request?.commercialFlow ||
        (prospectId &&
          (await tx.purchaseRequest.findFirst({
            where: { prospectId, commercialFlow: { not: Prisma.DbNull } },
          })))
      )
        throw new ConflictException(
          'Este pedido requiere el cierre unificado con la aceptación del cliente y sus cuotas.',
        );
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
            syncStatus: 'PENDING',
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
