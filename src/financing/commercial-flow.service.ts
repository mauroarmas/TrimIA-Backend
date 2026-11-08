import { FinancingNoticeService } from './financing-notice.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  Logger,
} from '@nestjs/common';
import { Prisma, PurchaseRequest } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  STOCK_PORT,
  StockPort,
  StockItem,
} from '../ai/integrations/ports/stock.port';
import {
  asCommercialFlow,
  CommercialFlow,
  deliveryFor,
  futureFirstDue,
  mockOffers,
  normalizeCommercial,
  OFFER_VALIDITY_MS,
  offerText,
} from './commercial-flow';
import {
  CloseCommercialDto,
  EditCommercialDto,
  ReviewCommercialDto,
} from './dto/commercial.dto';
import { weeklyPlan } from './weekly-plan';
import { financingConflict } from './financing.types';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
@Injectable()
export class CommercialFlowService {
  private readonly logger = new Logger(CommercialFlowService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
    @Optional() private readonly notices?: FinancingNoticeService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}
  private flow(request: PurchaseRequest) {
    const flow = asCommercialFlow(request.commercialFlow);
    if (!flow)
      throw new ConflictException(
        'Este pedido utiliza el circuito anterior. Conservá su gestión histórica.',
      );
    return flow;
  }
  private async lock(tx: Tx, id: string, version?: number) {
    await tx.$queryRaw`SELECT id FROM "PurchaseRequest" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.purchaseRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Pedido no encontrado');
    if (version !== undefined && row.version !== version)
      throw financingConflict('STALE_VERSION');
    return row;
  }
  private async event(
    tx: Tx,
    row: PurchaseRequest,
    kind: string,
    payload: Record<string, unknown> = {},
  ) {
    await tx.orchestrationEvent.create({
      data: {
        conversationId: row.conversationId,
        eventType: `FINANCING_${kind}`,
        payload: json({ requestId: row.id, ...payload }),
      },
    });
  }
  private async item(row: PurchaseRequest): Promise<StockItem | null> {
    const sku = (row.inputSnapshot as any)?.sku;
    if (!sku) return null;
    try {
      return (await this.stock.checkAvailability(sku, 'CLIENTE')).item;
    } catch {
      return null;
    }
  }
  private reason(
    row: PurchaseRequest,
    flow: CommercialFlow,
    item: StockItem | null,
  ) {
    if (Date.now() >= Date.parse(flow.expiresAt))
      return 'Venció la vigencia de 48 horas del pedido.';
    if (!item || item.stock < 1)
      return 'El producto ya no está disponible. Revisar disponibilidad.';
    const snapshot = row.inputSnapshot as any;
    if (
      item.listPrice != null &&
      new Prisma.Decimal(item.listPrice).toFixed(2) !== snapshot.amount
    )
      return 'Cambió el precio del producto.';
    for (const offer of flow.offers) {
      const current = mockOffers(item, snapshot.amount).find(
        (o) => o.id === offer.id,
      );
      if (!current || current.total !== offer.total)
        return 'Cambió una de las ofertas aprobadas.';
      if (offer.modality === 'FINANCED' && !futureFirstDue(offer.firstDueDate))
        return 'El primer vencimiento del plan ya no es válido.';
    }
    return null;
  }
  private async toReview(
    tx: Tx,
    row: PurchaseRequest,
    flow: CommercialFlow,
    reason: string,
  ) {
    const next: CommercialFlow = {
      ...flow,
      stage: 'REVIEW',
      revision: flow.revision + 1,
      offers: [],
      reviewReason: reason,
    };
    delete next.acceptedRevision;
    delete next.acceptedMessageId;
    delete next.summaryMessageId;
    await tx.purchaseRequest.update({
      where: { id: row.id },
      data: {
        commercialFlow: json(next),
        status: 'PENDING_REVIEW',
        version: { increment: 1 },
        evaluationState: 'PENDING',
        reviewedAt: null,
        reviewedById: null,
      },
    });
    await tx.outboundCommunication.updateMany({
      where: { purchaseRequestId: row.id, status: 'PENDING' },
      data: { status: 'FAILED', lastErrorCode: 'CONDITIONS_CHANGED' },
    });
    await this.event(tx, row, 'REVALIDATION_REQUIRED', { reason });
    return next;
  }
  async revalidate(id: string) {
    const row = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    });
    const flow = this.flow(row);
    if (row.closedAt || row.status === 'CANCELLED' || flow.stage === 'REVIEW')
      return;
    const item = await this.item(row);
    const reason = this.reason(row, flow, item);
    if (!reason) return;
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.version !== row.version || current.closedAt) return;
      await this.toReview(tx, current, this.flow(current), reason);
    });
  }
  async expireOrders() {
    const rows = await this.prisma.purchaseRequest.findMany({
      where: {
        closedAt: null,
        status: { in: ['APPROVED', 'REJECTED'] },
        commercialFlow: { path: ['expiresAt'], lt: new Date().toISOString() },
      },
      select: { id: true },
      take: 100,
    });
    for (const row of rows) await this.revalidate(row.id);
  }
  async catalog(id: string) {
    const row = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    });
    const item = await this.item(row);
    return item ? mockOffers(item, (row.inputSnapshot as any)?.amount) : [];
  }
  async review(id: string, dto: ReviewCommercialDto, actorId: string) {
    const initial = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    });
    const item = await this.item(initial);
    if (!item || item.stock < 1)
      throw new ConflictException(
        'Revisá el producto y su stock antes de habilitar ofertas.',
      );
    const available = mockOffers(item, (initial.inputSnapshot as any)?.amount);
    const offers = dto.offerIds.map((key) =>
      available.find((o) => o.id === key),
    );
    if (offers.some((o) => !o))
      throw new BadRequestException(
        'Solo se pueden habilitar ofertas vigentes del catálogo mock.',
      );
    if (dto.decision === 'APPROVED' && !offers.length)
      throw new BadRequestException('Habilitá al menos una oferta.');
    if (
      dto.decision === 'REJECTED' &&
      offers.some((o) => o!.modality !== 'CASH')
    )
      throw new BadRequestException(
        'Una financiación rechazada solo puede ofrecer contado.',
      );
    if (!dto.note?.trim())
      throw new BadRequestException('Dejá constancia de la revisión.');
    const financed = offers.some((o) => o!.modality === 'FINANCED');
    if (financed && (!dto.collectorId || !futureFirstDue(dto.firstDueDate)))
      throw new BadRequestException(
        'Elegí un cobrador y un primer vencimiento futuro válido.',
      );
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, dto.expectedVersion);
      const flow = this.flow(row);
      if (
        row.closedAt ||
        row.status !== 'PENDING_REVIEW' ||
        flow.stage !== 'REVIEW'
      )
        throw financingConflict('ALREADY_RESOLVED');
      if (Date.now() >= Date.parse(flow.expiresAt))
        throw new ConflictException(
          'Vencieron las 48 horas. Renoválas y revisá la nueva evaluación antes de decidir.',
        );
      if (row.evaluationState !== 'READY')
        throw financingConflict('EVALUATION_PENDING');
      const assessment = await tx.creditAssessment.findUnique({
        where: {
          purchaseRequestId_requestVersion: {
            purchaseRequestId: id,
            requestVersion: row.version,
          },
        },
      });
      if (!assessment) throw financingConflict('EVALUATION_PENDING');
      if (financed) await this.collector(tx, row.clientId, dto.collectorId!);
      const currentPrice =
        item.listPrice == null
          ? (row.inputSnapshot as any).amount
          : new Prisma.Decimal(item.listPrice).toFixed(2);
      if (currentPrice !== (row.inputSnapshot as any).amount)
        throw new ConflictException(
          'El precio cambió. Renovar datos y evaluación antes de decidir.',
        );
      const next: CommercialFlow = {
        ...flow,
        stage: 'CHOOSING',
        revision: flow.revision + 1,
        offers: offers.map((o) => ({
          ...o!,
          ...(o!.modality === 'FINANCED'
            ? { collectorId: dto.collectorId, firstDueDate: dto.firstDueDate }
            : {}),
        })),
      };
      delete next.acceptedRevision;
      delete next.summaryMessageId;
      delete next.selectedOfferId;
      delete next.reviewReason;
      await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: dto.decision,
          version: { increment: 1 },
          commercialFlow: json(next),
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNote: dto.note.trim(),
          reviewedSnapshot: row.inputSnapshot!,
        },
      });
      const body = this.nextMessage(row, next, dto.decision);
      await tx.outboundCommunication.create({
        data: {
          purchaseRequestId: id,
          conversationId: row.conversationId!,
          dedupeKey: `financing-decision:${id}:${row.version + 1}`,
          body,
          transportMode: 'simulated',
        },
      });
      await this.event(tx, row, 'DECIDED', {
        actorId,
        requestVersion: row.version + 1,
      });
    });
    return this.commercial(id);
  }
  private async collector(tx: Tx, clientId: string, collectorId: string) {
    const collector = await tx.employee.findFirst({
      where: { id: collectorId, isActive: true, sector: { name: 'Cobranzas' } },
    });
    if (!collector)
      throw new BadRequestException('Elegí un cobrador activo de Cobranzas.');
    const client = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
    });
    if (
      client.assignedCollectorId &&
      client.assignedCollectorId !== collectorId
    )
      throw new ConflictException(
        'El cliente ya tiene otro cobrador. Conservá el responsable o reasigná su cartera desde Cobranzas.',
      );
  }
  async renew(id: string, version: number, actorId: string) {
    const initial = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    });
    const item = await this.item(initial);
    if (!item || item.stock < 1)
      throw new ConflictException(
        'Primero corregí el producto o resolvé su disponibilidad.',
      );
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, version);
      if (row.closedAt || row.status === 'CANCELLED')
        throw financingConflict('ALREADY_RESOLVED');
      const flow = this.flow(row);
      const startedAt = new Date();
      const next = {
        ...flow,
        stage: 'REVIEW' as const,
        offers: [],
        revision: flow.revision + 1,
        startedAt: startedAt.toISOString(),
        expiresAt: new Date(
          startedAt.getTime() + OFFER_VALIDITY_MS,
        ).toISOString(),
        reviewReason:
          'Condiciones renovadas; revisar nueva evaluación y habilitar ofertas.',
      };
      delete next.acceptedRevision;
      delete next.acceptedMessageId;
      delete next.summaryMessageId;
      delete next.selectedOfferId;
      const amount =
        item.listPrice != null
          ? new Prisma.Decimal(item.listPrice).toFixed(2)
          : (row.inputSnapshot as any).amount;
      const snapshot = {
        ...(row.inputSnapshot as any),
        amount,
        inputVersion: row.version + 1,
      };
      await tx.purchaseRequest.update({
        where: { id },
        data: {
          commercialFlow: json(next),
          inputSnapshot: json(snapshot),
          amount,
          status: 'PENDING_REVIEW',
          version: { increment: 1 },
          evaluationState: 'PENDING',
          reviewedAt: null,
          reviewedById: null,
        },
      });
      await tx.outboundCommunication.updateMany({
        where: { purchaseRequestId: id, status: 'PENDING' },
        data: { status: 'FAILED', lastErrorCode: 'CONDITIONS_RENEWED' },
      });
      await this.event(tx, row, 'RENEWED', {
        actorId,
        requestVersion: row.version + 1,
      });
    });
    return this.commercial(id);
  }
  async commercial(id: string) {
    await this.revalidate(id);
    const row = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            dni: true,
            phone: true,
            assignedCollectorId: true,
          },
        },
        financing: { include: { quotas: { orderBy: { number: 'asc' } } } },
        outboundCommunications: {
          where: { purpose: 'SALE_CLOSED' },
          take: 1,
          select: {
            id: true,
            status: true,
            transportMode: true,
            lastErrorCode: true,
            acceptedAt: true,
          },
        },
      },
    });
    const flow = this.flow(row);
    const snapshot = row.inputSnapshot as any;
    const collectorId = flow.offers.find(
      (offer) => offer.id === flow.selectedOfferId,
    )?.collectorId;
    const collector = collectorId
      ? await this.prisma.employee.findUnique({
          where: { id: collectorId },
          select: { id: true, name: true },
        })
      : null;
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      closedAt: row.closedAt,
      productSummary: row.productSummary,
      amount: row.amount,
      conversationId: row.conversationId,
      prospectId: row.prospectId,
      client: { ...row.client, name: snapshot.name, dni: snapshot.dni },
      collector,
      closingNotice: row.outboundCommunications[0] ?? null,
      suggestedClosingMessage: flow.selectedOfferId
        ? this.closingMessage(row, flow)
        : '',
      sku: snapshot.sku,
      purchaseUse:
        snapshot.purchaseUse ?? (snapshot.business ? 'BUSINESS' : null),
      business: snapshot.business,
      locality: snapshot.locality,
      flow,
      financing: row.financing,
      expired: Date.now() >= Date.parse(flow.expiresAt),
      delivery: deliveryFor(snapshot.locality || '') ?? null,
    };
  }
  async list() {
    const rows = await this.prisma.purchaseRequest.findMany({
      where: { commercialFlow: { not: Prisma.DbNull } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((row) => this.commercial(row.id)));
  }
  private nextMessage(
    row: PurchaseRequest,
    flow: CommercialFlow,
    status = row.status,
  ) {
    if (row.closedAt || flow.stage === 'CLOSED')
      return 'Tu venta ya quedó registrada. Si necesitás ayuda con la entrega, contame.';
    if (flow.stage === 'REVIEW')
      return 'Tu pedido está en revisión de Administración. Conservamos tus datos; te avisaremos cuando estén habilitadas las condiciones para continuar.';
    if (!flow.offers.length)
      return 'Tu financiación no fue aprobada y no hay una alternativa de contado habilitada para este pedido. Si querés hablar con una persona, decímelo.';
    if (flow.stage === 'READY')
      return 'Ya recibimos tu confirmación. Ventas revisará el resumen para registrar el cierre. Todavía no se registró un pago.';
    const prefix =
      status === 'REJECTED'
        ? 'La financiación no fue aprobada. Podés elegir esta alternativa de contado habilitada: '
        : 'Administración habilitó estas opciones: ';
    if (!flow.selectedOfferId)
      return (
        prefix +
        flow.offers.map((o, i) => `\n${i + 1}. ${offerText(o)}`).join('') +
        '\n¿Cuál elegís?'
      );
    const delivery = deliveryFor((row.inputSnapshot as any).locality || '');
    if (!flow.deliveryMode)
      return `Elegiste ${offerText(flow.offers.find((o) => o.id === flow.selectedOfferId)!)}. ¿Retirás en sucursal${delivery ? ` o preferís envío a ${delivery.locality} por $${Number(delivery.cost).toLocaleString('es-AR')}, a pagar aparte al contado` : '? Por ahora no hay envío habilitado a tu localidad'}?`;
    if (flow.deliveryMode === 'SHIPPING' && !flow.deliveryAddress)
      return '¿Cuál es la dirección de entrega? Incluí calle, número y referencias. El envío se paga aparte al contado.';
    const s = row.inputSnapshot as any;
    const offer = flow.offers.find((o) => o.id === flow.selectedOfferId)!;
    return `Resumen del pedido: ${s.name}, DNI ${s.dni}; ${s.purchaseUse === 'PERSONAL' ? 'compra personal' : `comercio ${s.business}`}, ${s.locality}. Una unidad de ${row.productSummary}. ${offerText(offer)}. ${flow.deliveryMode === 'PICKUP' ? 'Retiro en sucursal, sin costo de envío.' : `Envío a ${flow.deliveryAddress}; costo $${Number(flow.shippingCost).toLocaleString('es-AR')}, separado y al contado.`}${flow.contactName || flow.contactPhone ? ` Contacto de entrega: ${flow.contactName || s.name}, ${flow.contactPhone || s.phone}.` : ''} Vigente hasta ${new Date(flow.expiresAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Tucuman', hour12: false })}. ¿Confirmás este resumen para que Ventas prepare el cierre?`;
  }
  async customerMessage(
    id: string,
    messageId: string,
    message: string,
    input: {
      deliveryAddress?: string;
      contactName?: string;
      contactPhone?: string;
    } = {},
  ) {
    await this.revalidate(id);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id);
      const flow = this.flow(row);
      const conversation = await tx.conversation.findUnique({
        where: { id: row.conversationId! },
        select: { status: true },
      });
      if (conversation?.status !== 'ACTIVE') return { handled: true };
      const seen = await tx.orchestrationEvent.findUnique({
        where: { actionKey: `commercial:message:${messageId}` },
      });
      if (seen) return { handled: true, response: this.nextMessage(row, flow) };
      if (row.status === 'CANCELLED')
        return {
          handled: true,
          response:
            'Este pedido está cancelado. Si querés hacer otra compra, pedime iniciar un pedido nuevo.',
        };
      if (row.closedAt || flow.stage === 'REVIEW')
        return { handled: true, response: this.nextMessage(row, flow) };
      const next = { ...flow };
      const normalized = normalizeCommercial(message);
      let choice = flow.offers.find(
        (o) => o.modality === 'CASH' && /\bcontado\b/.test(normalized),
      );
      if (!choice)
        choice = flow.offers.find(
          (o) =>
            o.modality === 'FINANCED' &&
            new RegExp(`\\b${o.quotaCount}\\s*(?:cuotas|semanas)\\b`).test(
              normalized,
            ),
        );
      const numbered = normalized.match(/^(?:opcion\s*)?([123])(?:[.!\s]|$)/);
      if (!choice && numbered) choice = flow.offers[Number(numbered[1]) - 1];
      if (choice && next.selectedOfferId !== choice.id) {
        if (flow.acceptedRevision !== undefined) {
          await this.toReview(
            tx,
            row,
            flow,
            'El cliente cambió el plan después de confirmar el resumen.',
          );
          return {
            handled: true,
            response:
              'Guardamos el cambio solicitado. Administración debe revisar las condiciones y después te pediremos confirmar el nuevo resumen.',
          };
        }
        next.selectedOfferId = choice.id;
      }
      if (/\b(retiro|retirar|busco en|paso por)\b/.test(normalized)) {
        next.deliveryMode = 'PICKUP';
        next.shippingCost = '0.00';
        delete next.deliveryAddress;
      }
      if (/\b(envio|enviar|entrega a domicilio)\b/.test(normalized)) {
        const delivery = deliveryFor((row.inputSnapshot as any).locality || '');
        if (!delivery)
          return {
            handled: true,
            response:
              'No tenemos un envío precargado para tu localidad. Podés retirar en sucursal o pedirme hablar con una persona para consultar otra alternativa.',
          };
        next.deliveryMode = 'SHIPPING';
        next.shippingCost = delivery.cost;
      }
      if (input.deliveryAddress && next.deliveryMode === 'SHIPPING')
        next.deliveryAddress = input.deliveryAddress;
      if (input.contactName) next.contactName = input.contactName;
      if (input.contactPhone) next.contactPhone = input.contactPhone;
      const changed = JSON.stringify(next) !== JSON.stringify(flow);
      if (changed) {
        next.revision++;
        next.stage = 'CHOOSING';
        delete next.acceptedRevision;
        delete next.acceptedMessageId;
        delete next.summaryMessageId;
      }
      const complete =
        !!next.selectedOfferId &&
        !!next.deliveryMode &&
        (next.deliveryMode === 'PICKUP' || !!next.deliveryAddress);
      const confirming =
        /^(?:si(?:,?\s+confirmo)?|confirmo|acepto|de acuerdo)(?:[.!\s]|$)/i.test(
          normalized,
        ) && !/\b(?:pero|cambi|no |excepto|salvo)\b/.test(normalized);
      if (!changed && complete && flow.summaryMessageId && confirming) {
        next.acceptedRevision = next.revision;
        next.acceptedMessageId = messageId;
        next.stage = 'READY';
      } else if (complete) next.summaryMessageId = messageId;
      await tx.purchaseRequest.update({
        where: { id },
        data: { commercialFlow: json(next), version: { increment: 1 } },
      });
      await tx.orchestrationEvent.create({
        data: {
          conversationId: row.conversationId,
          eventType:
            next.stage === 'READY'
              ? 'FINANCING_CUSTOMER_ACCEPTED'
              : 'FINANCING_CUSTOMER_SELECTION',
          actionKey: `commercial:message:${messageId}`,
          payload: json({
            requestId: id,
            sourceMessageId: messageId,
            revision: next.revision,
          }),
        },
      });
      return { handled: true, response: this.nextMessage(row, next) };
    });
  }
  async cancelFromCustomer(
    id: string,
    expectedVersion: number,
    sourceMessageId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, expectedVersion);
      if (row.closedAt)
        throw new ConflictException(
          'Una venta cerrada requiere atención humana para su cancelación.',
        );
      await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          activeKey: null,
          version: { increment: 1 },
        },
      });
      await tx.outboundCommunication.updateMany({
        where: { purchaseRequestId: id, status: 'PENDING' },
        data: { status: 'FAILED', lastErrorCode: 'ORDER_CANCELLED' },
      });
      await this.event(tx, row, 'CANCELLED', { sourceMessageId });
    });
  }
  async edit(id: string, dto: EditCommercialDto, actorId: string) {
    let product: StockItem | null = null;
    if (dto.sku)
      try {
        product = (await this.stock.checkAvailability(dto.sku, 'CLIENTE')).item;
      } catch {
        throw new BadRequestException('Producto no encontrado.');
      }
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, dto.expectedVersion);
      if (row.closedAt || row.status === 'CANCELLED')
        throw financingConflict('ALREADY_RESOLVED');
      const flow = this.flow(row);
      const next = { ...flow };
      if (dto.offerId && !flow.offers.some((o) => o.id === dto.offerId))
        throw new BadRequestException('Oferta no habilitada.');
      for (const key of [
        'deliveryMode',
        'deliveryAddress',
        'contactName',
        'contactPhone',
      ] as const)
        if (dto[key] !== undefined) (next as any)[key] = dto[key];
      if (next.deliveryMode === 'SHIPPING') {
        const delivery = deliveryFor((row.inputSnapshot as any).locality || '');
        if (!delivery)
          throw new BadRequestException(
            'Envío no habilitado para esta localidad.',
          );
        next.shippingCost = delivery.cost;
      } else {
        next.shippingCost = '0.00';
        delete next.deliveryAddress;
      }
      if (dto.offerId) next.selectedOfferId = dto.offerId;
      next.revision++;
      next.stage = 'CHOOSING';
      delete next.acceptedRevision;
      delete next.acceptedMessageId;
      delete next.summaryMessageId;
      if (dto.sku || (dto.offerId && dto.offerId !== flow.selectedOfferId)) {
        if (product && (!product.listPrice || product.stock < 1))
          throw new BadRequestException(
            'El producto necesita stock y precio confirmado.',
          );
        const snapshot = {
          ...(row.inputSnapshot as any),
          ...(product
            ? {
                sku: product.sku,
                productSummary: product.name,
                amount: new Prisma.Decimal(product.listPrice!).toFixed(2),
              }
            : {}),
          inputVersion: row.version + 1,
        };
        await tx.purchaseRequest.update({
          where: { id },
          data: {
            inputSnapshot: json(snapshot),
            productSummary: snapshot.productSummary,
            amount: snapshot.amount,
          },
        });
        await this.toReview(
          tx,
          row,
          next,
          'Se modificó producto o plan. Requiere revisión y nueva aceptación del cliente.',
        );
      } else
        await tx.purchaseRequest.update({
          where: { id },
          data: { commercialFlow: json(next), version: { increment: 1 } },
        });
      await this.event(tx, row, 'STAFF_EDITED', { actorId });
    });
    return this.commercial(id);
  }
  private closingMessage(row: PurchaseRequest, flow: CommercialFlow) {
    const offer = flow.offers.find((o) => o.id === flow.selectedOfferId);
    if (!offer) return '';
    return `Registramos el cierre de tu compra de ${row.productSummary}. ${offerText(offer)}. ${flow.deliveryMode === 'PICKUP' ? 'Retiro en sucursal.' : `Envío a ${flow.deliveryAddress}; costo separado al contado: $${flow.shippingCost}.`} Este registro no acredita un pago.`;
  }
  async close(id: string, dto: CloseCommercialDto, actorId: string) {
    await this.revalidate(id); // Persistir el bloqueo aun si la operación de cierre se rechaza.
    const initial = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    });
    const item = await this.item(initial);
    const result = await this.prisma.$transaction(async (tx) => {
      // El ingreso de mensajes también bloquea primero el hilo y luego el pedido.
      if (initial.conversationId)
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${initial.conversationId} FOR UPDATE`;
      const row = await this.lock(tx, id);
      const flow = this.flow(row);
      if (row.status === 'CANCELLED')
        throw new ConflictException('El pedido está cancelado.');
      if (row.closedAt && flow.stage === 'CLOSED')
        return { id, closedAt: row.closedAt, replayed: true };
      if (row.version !== dto.expectedVersion)
        throw financingConflict('STALE_VERSION');
      if (
        this.reason(row, flow, item) ||
        flow.stage !== 'READY' ||
        flow.acceptedRevision !== flow.revision
      )
        throw new ConflictException(
          'El pedido requiere revisión o aceptación del resumen vigente antes de cerrar.',
        );
      const offer = flow.offers.find((o) => o.id === flow.selectedOfferId);
      if (
        !offer ||
        (offer.modality === 'FINANCED' && row.status !== 'APPROVED')
      )
        throw new ConflictException(
          'La oferta elegida no tiene aprobación vigente.',
        );
      if (!dto.reference?.trim())
        throw new BadRequestException('Ingresá la constancia del cierre.');
      if (dto.customerMessage !== undefined && !dto.customerMessage.trim())
        throw new BadRequestException(
          'Escribí el mensaje final para el cliente.',
        );
      const conversation = row.conversationId
        ? await tx.conversation.findUnique({
            where: { id: row.conversationId },
          })
        : null;
      if (!conversation)
        throw new ConflictException(
          'No se encuentra la conversación del pedido.',
        );
      if (
        conversation.status === 'HUMAN_HANDLING' &&
        conversation.handledById !== actorId
      )
        throw new ConflictException(
          'Otra persona tiene el control del chat. Debe liberarlo antes de cerrar la venta.',
        );
      if (
        !['ACTIVE', 'HUMAN_HANDLING'].includes(conversation.status) ||
        (await tx.escalation.count({
          where: { conversationId: conversation.id, status: 'PENDING' },
        }))
      )
        throw new ConflictException(
          'Resolvé la atención pendiente del chat antes de cerrar la venta.',
        );
      const controlReleased = conversation.status === 'HUMAN_HANDLING';

      if (offer.modality === 'FINANCED') {
        await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${row.clientId} FOR UPDATE`;
        await this.collector(tx, row.clientId, offer.collectorId!);
        const schedule = weeklyPlan(
          offer.total,
          offer.quotaCount,
          offer.firstDueDate!,
        );
        await tx.financing.create({
          data: {
            purchaseRequestId: id,
            totalAmount: offer.total,
            quotaCount: offer.quotaCount,
            collectorId: offer.collectorId,
            quotas: {
              create: schedule.map((q) => ({ ...q, clientId: row.clientId })),
            },
          },
        });
        await tx.client.update({
          where: { id: row.clientId },
          data: { assignedCollectorId: offer.collectorId },
        });
      }
      const closedAt = new Date();
      await tx.purchaseRequest.update({
        where: { id },
        data: {
          closedAt,
          closedById: actorId,
          commercialFlow: json({ ...flow, stage: 'CLOSED' }),
          version: { increment: 1 },
        },
      });
      if (row.prospectId)
        await tx.prospect.update({
          where: { id: row.prospectId },
          data: {
            status: 'VENTA_CERRADA',
            closedAt,
            sellerId: actorId,
            estimatedAmount: offer.total,
            modality: offer.modality,
            syncStatus: 'PENDING',
            notes: `[CIERRE] ${dto.reference.trim()}`,
          },
        });
      await this.event(tx, row, 'SALE_CLOSED', {
        actorId,
        reference: dto.reference.trim(),
        controlReleased,
        quotaCount: offer.quotaCount,
        offerId: offer.id,
      });
      await tx.outboundCommunication.updateMany({
        where: {
          purchaseRequestId: id,
          purpose: 'FINANCING_DECISION',
          status: 'PENDING',
        },
        data: { status: 'FAILED', lastErrorCode: 'SALE_ALREADY_CLOSED' },
      });
      if (controlReleased) {
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { status: 'ACTIVE', handledById: null, handledAt: null },
        });
        await tx.orchestrationEvent.create({
          data: {
            conversationId: conversation.id,
            eventType: 'conversation_release',
            payload: {
              employeeId: actorId,
              requestId: id,
              reason: 'SALE_CLOSED',
            },
          },
        });
      }
      const body =
        dto.customerMessage?.trim() || this.closingMessage(row, flow);
      let messageId: string | undefined;
      if (dto.customerMessage !== undefined) {
        messageId = (
          await tx.message.create({
            data: {
              conversationId: conversation.id,
              role: 'ASSISTANT',
              agentType: 'SALES',
              content: body,
            },
          })
        ).id;
        await tx.orchestrationEvent.create({
          data: {
            conversationId: conversation.id,
            eventType: 'conversation_manual_reply',
            payload: { employeeId: actorId, messageId, source: 'SALE_CLOSED' },
          },
        });
      }
      await tx.outboundCommunication.create({
        data: {
          purchaseRequestId: id,
          conversationId: conversation.id,
          dedupeKey: `commercial-close:${id}`,
          purpose: 'SALE_CLOSED',
          body,
          messageId,
          transportMode: 'simulated',
        },
      });
      return { id, closedAt, replayed: false, controlReleased };
    });
    if (initial.conversationId && result.controlReleased && this.realtime) {
      const current = await this.prisma.conversation.findUnique({
        where: { id: initial.conversationId },
        select: { status: true, currentAgent: true },
      });
      if (current)
        await this.realtime.publish(initial.conversationId, {
          type: 'status',
          conversationId: initial.conversationId,
          data: current,
        });
    }
    const notice = await this.prisma.outboundCommunication.findUnique({
      where: { dedupeKey: `commercial-close:${id}` },
    });
    if (notice && this.notices) {
      try {
        await this.notices.dispatch(notice.id);
      } catch (error) {
        this.logger.warn(
          `Venta ${id} registrada; el aviso continúa pendiente de recuperación.`,
        );
      }
    }
    if (!result.replayed && notice && this.realtime) {
      const sent = await this.prisma.outboundCommunication.findUnique({
        where: { id: notice.id },
        include: { message: true },
      });
      if (sent?.message && ['ACCEPTED', 'DELIVERED'].includes(sent.status)) {
        const message = sent.message;
        await this.realtime.publish(sent.conversationId, {
          type: 'message',
          conversationId: sent.conversationId,
          data: {
            id: message.id,
            role: 'ASSISTANT',
            content: message.content,
            agentType: message.agentType,
            createdAt: message.createdAt.toISOString(),
          },
        });
      }
    }
    return result;
  }
}
