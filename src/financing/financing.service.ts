import { CommercialFlowService } from './commercial-flow.service';
import { OFFER_VALIDITY_MS } from './commercial-flow';
import { CreateFinancingPlanDto } from './dto/create-financing-plan.dto';
import { weeklyPlan } from './weekly-plan';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PurchaseRequest } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { STOCK_PORT, StockPort } from '../ai/integrations/ports/stock.port';
import {
  fieldsSchema,
  financingDraftSchema,
  FinancingDraft,
  amountSchema,
} from './financing-draft.schema';
import { financingConflict } from './financing.types';
import { financingNoticeBody } from './financing-notice.template';
export interface FinancingInput {
  flowVersion?: 2;
  purchaseUse?: 'PERSONAL' | 'BUSINESS';
  business?: string;
  locality?: string;
  intent:
    | 'INFORMATION'
    | 'REQUEST'
    | 'PROVIDE_DATA'
    | 'CONFIRM'
    | 'CANCEL'
    | 'OTHER';
  name?: string;
  dni?: string;
  productSummary?: string;
  sku?: string;
  observedAmount?: string;
}
type Tx = Prisma.TransactionClient;
const publicNotice = {
  id: true,
  version: true,
  status: true,
  transportMode: true,
  providerMessageId: true,
  attemptCount: true,
  lastErrorCode: true,
  acceptedAt: true,
} as const;
export const financingSelection = {
  id: true,
  productSummary: true,
  amount: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  closedAt: true,
  reviewNote: true,
  version: true,
  conversationId: true,
  prospectId: true,
  evaluationState: true,
  commercialFlow: true,
  inputSnapshot: true,
  reviewedSnapshot: true,
  client: {
    select: {
      id: true,
      name: true,
      dni: true,
      phone: true,
      assignedCollectorId: true,
    },
  },
  reviewedBy: { select: { id: true, name: true } },
  financing: {
    select: {
      id: true,
      status: true,
      quotaCount: true,
      totalAmount: true,
      collectorId: true,
    },
  },
  creditAssessments: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      verdict: true,
      reason: true,
      source: true,
      createdAt: true,
      requestVersion: true,
      inputSnapshot: true,
    },
  },
  outboundCommunications: {
    take: 1,
    orderBy: { createdAt: 'desc' as const },
    select: publicNotice,
  },
} as const;
@Injectable()
export class FinancingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
    @Optional() private readonly commercial?: CommercialFlowService,
  ) {}
  private userInput<T>(
    schema: { parse(value: unknown): T },
    value: unknown,
  ): T {
    try {
      return schema.parse(value);
    } catch {
      throw new BadRequestException(
        'Datos de financiación inválidos; revisá los campos indicados.',
      );
    }
  }
  private json(v: unknown) {
    return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonObject;
  }
  private async event(
    tx: Tx,
    conversationId: string | null,
    type: string,
    payload: Record<string, unknown>,
    actionKey?: string,
  ) {
    return tx.orchestrationEvent.create({
      data: {
        conversationId,
        eventType: 'FINANCING_' + type,
        payload: this.json(payload),
        actionKey,
      },
    });
  }
  private parsed(v: unknown): FinancingDraft {
    return financingDraftSchema.parse(
      v || { schemaVersion: 1, stage: 'COLLECTING' },
    );
  }
  private missing(d: FinancingDraft) {
    return [
      'name',
      'dni',
      'productSummary',
      'confirmedAmount',
      ...(d.flowVersion === 2
        ? [...(d.purchaseUse === 'PERSONAL' ? [] : ['business']), 'locality']
        : []),
    ].filter((k) => !d[k as keyof FinancingDraft]);
  }
  private summary(d: FinancingDraft) {
    return `Solicitud: ${d.name}, DNI ${d.dni}; ${d.productSummary}, ARS ${d.confirmedAmount}. ¿Confirmás estos datos y que querés solicitar financiación? Un supervisor decidirá.`;
  }
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${id} FOR NO KEY UPDATE`;
  }
  async getDraft(id: string) {
    const c = await this.prisma.conversation.findUnique({ where: { id } });
    if (!c?.financingDraft)
      throw new NotFoundException('Borrador no encontrado');
    const d = this.parsed(c.financingDraft);
    const missing = this.missing(d).map((k) =>
      k === 'productSummary' ? 'product' : k,
    );
    if (d.stage === 'AWAITING_CONFIRMATION')
      missing.push('customerConfirmation');
    const {
      priceConfirmationNote: _priceConfirmationNote,
      sourceMessageIds: _sourceMessageIds,
      summaryVersion: _summaryVersion,
      schemaVersion: _schemaVersion,
      caseKey: _caseKey,
      requestVersion: _requestVersion,
      ...visible
    } = d;
    const request = d.purchaseRequestId
      ? await this.prisma.purchaseRequest.findUnique({
          where: { id: d.purchaseRequestId },
          select: {
            id: true,
            status: true,
            productSummary: true,
            amount: true,
            prospectId: true,
            closedAt: true,
            commercialFlow: true,
            financing: { select: { id: true, quotaCount: true, status: true } },
          },
        })
      : null;
    return {
      ...visible,
      request: request
        ? {
            ...request,
            commercialFlow: request.commercialFlow
              ? {
                  stage: (request.commercialFlow as any).stage,
                  expiresAt: (request.commercialFlow as any).expiresAt,
                }
              : null,
          }
        : null,
      conversationId: id,
      version: c.financingVersion,
      missingFields: missing,
    };
  }
  async updateDraft(id: string, dto: any, actorId: string) {
    const data = fieldsSchema
      .partial()
      .parse(
        Object.fromEntries(
          Object.entries(dto).filter(([k]) =>
            [
              'name',
              'dni',
              'productSummary',
              'sku',
              'business',
              'purchaseUse',
              'locality',
            ].includes(k),
          ),
        ),
      );
    const amount = this.userInput(amountSchema, dto.confirmedAmount);
    if (!dto.note?.trim()) throw new BadRequestException('Nota obligatoria');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      const c = await tx.conversation.findUnique({ where: { id } });
      if (!c?.financingDraft) throw new NotFoundException();
      if (c.financingVersion !== dto.expectedVersion)
        throw financingConflict('STALE_VERSION');
      const d = this.parsed(c.financingDraft);
      if (d.purchaseRequestId) {
        const linked = await tx.purchaseRequest.findUnique({
          where: { id: d.purchaseRequestId },
        });
        if (linked?.commercialFlow)
          throw new ConflictException(
            'Modificá el pedido desde su ficha comercial; requiere nueva revisión y aceptación.',
          );
      }
      if (d.stage === 'CANCELLED') throw financingConflict('ALREADY_RESOLVED');
      const next = {
        ...d,
        ...data,
        confirmedAmount: amount,
        priceSource: 'SUPERVISOR' as const,
        priceConfirmedAt: new Date().toISOString(),
        priceConfirmedById: actorId,
        priceConfirmationNote: dto.note.trim(),
        stage: 'COLLECTING' as const,
      };
      delete next.summaryVersion;
      await tx.conversation.update({
        where: { id },
        data: {
          financingDraft: this.json(next),
          financingVersion: { increment: 1 },
        },
      });
      await this.event(tx, id, 'DRAFT_CORRECTED', {
        actorId,
        draftVersion: c.financingVersion + 1,
        requestId: d.purchaseRequestId,
        caseKey: d.caseKey,
      });
    });
    return this.getDraft(id);
  }
  async stockPrice(input: FinancingInput) {
    if (!input.sku) return null;
    try {
      const result = await this.stock.checkAvailability(input.sku, 'CLIENTE');
      return result.item.sku === input.sku &&
        result.item.listPrice != null &&
        result.item.listPrice > 0
        ? Number(result.item.listPrice).toFixed(2)
        : null;
    } catch {
      return null;
    }
  }
  private async saveDraftProspect(
    tx: Tx,
    c: { id: string; externalId: string; channel: any },
    d: FinancingDraft,
  ) {
    const previousProspect = await tx.prospect.findFirst({
      where: {
        conversationId: c.id,
        phone: c.externalId,
        closedAt: null,
        status: { in: ['NUEVO', 'EN_CONTACTO', 'CALIFICA'] },
        ...(d.prospectId
          ? { id: d.prospectId }
          : { productInterest: d.productSummary! }),
        purchaseRequests: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
    });
    const prospectData = {
      name: d.name || previousProspect?.name || 'Cliente',
      dni: d.dni,
      comercio: d.purchaseUse === 'PERSONAL' ? null : d.business,
      localidad: d.locality,
      originChannel: c.channel,
      phone: c.externalId,
      productInterest: d.productSummary!,
      estimatedAmount: d.confirmedAmount || null,
      modality: 'FINANCED' as const,
      conversationId: c.id,
      syncStatus: 'PENDING' as const,
      crmData: this.json({
        ...((previousProspect?.crmData as any) || {}),
        sheet: {
          ...((previousProspect?.crmData as any)?.sheet || {}),
          Nombre: d.name || previousProspect?.name || 'Cliente',
          Teléfono: c.externalId,
          'Producto/s': d.productSummary!,
          Comercio:
            d.purchaseUse === 'PERSONAL'
              ? ''
              : (d.business ?? previousProspect?.comercio ?? ''),
          Localidad: d.locality ?? previousProspect?.localidad ?? '',
        },
      }),
    };
    return previousProspect
      ? await tx.prospect.update({
          where: { id: previousProspect.id },
          data: prospectData,
        })
      : await tx.prospect.create({ data: prospectData });
  }
  async applyInput(
    conversationId: string,
    messageId: string,
    input: FinancingInput,
  ) {
    const price = await this.stockPrice(input); // no I/O within the transaction
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, conversationId);
      const c = await tx.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      if (
        !['WHATSAPP', 'WEB'].includes(c.channel) ||
        c.userType !== 'CLIENTE' ||
        c.status !== 'ACTIVE' ||
        !/^\+?\d{8,15}$/.test(c.externalId)
      )
        return { handled: false };
      const actionKey = `financing:input:${messageId}`;
      const previous = await tx.orchestrationEvent.findUnique({
        where: { actionKey },
      });
      if (previous)
        return {
          handled: true,
          response: 'Tu solicitud quedó registrada para revisión humana.',
          replayed: true,
        };
      let d = this.parsed(c.financingDraft);
      if (input.flowVersion === 2 && !d.purchaseRequestId) d.flowVersion = 2;
      let active = d.purchaseRequestId
        ? await tx.purchaseRequest.findUnique({
            where: { id: d.purchaseRequestId },
          })
        : null;
      if (active && active.status !== 'PENDING_REVIEW') {
        if (input.intent !== 'REQUEST') return { handled: false };
        d = this.parsed(null);
        if (input.flowVersion === 2) d.flowVersion = 2;
        active = null;
      }
      if (d.stage === 'CANCELLED' && input.intent === 'REQUEST') {
        d = this.parsed(null);
        if (input.flowVersion === 2) d.flowVersion = 2;
      }
      if (
        active?.status === 'PENDING_REVIEW' &&
        d.requestVersion !== active.version &&
        active.inputSnapshot
      ) {
        const current = active.inputSnapshot as any;
        d = {
          ...d,
          name: current.name,
          dni: current.dni,
          productSummary: current.productSummary,
          confirmedAmount: current.amount,
          priceSource: current.priceSource,
          priceConfirmedAt: current.priceConfirmedAt,
          priceConfirmedById: current.priceConfirmedById,
          requestVersion: active.version,
          stage: 'COLLECTING',
        };
        if (current.sku) d.sku = current.sku;
        else delete d.sku;
        delete d.summaryVersion;
      }
      if (input.intent === 'INFORMATION' || input.intent === 'OTHER')
        return { handled: false };
      d.caseKey ||= randomUUID();
      if (input.intent === 'CANCEL') {
        if (active) {
          const changed = await tx.purchaseRequest.updateMany({
            where: {
              id: active.id,
              version: active.version,
              status: 'PENDING_REVIEW',
            },
            data: {
              status: 'CANCELLED',
              activeKey: null,
              cancelledAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw financingConflict('STALE_VERSION');
        }
        if (!active && d.prospectId)
          await tx.prospect.updateMany({
            where: {
              id: d.prospectId,
              conversationId: c.id,
              phone: c.externalId,
            },
            data: { status: 'CANCELADO', syncStatus: 'PENDING' },
          });
        d.stage = 'CANCELLED';
        delete d.summaryVersion;
        await tx.conversation.update({
          where: { id: c.id },
          data: {
            financingDraft: this.json(d),
            financingVersion: { increment: 1 },
          },
        });
        await this.event(
          tx,
          c.id,
          'CANCELLED',
          {
            requestId: active?.id,
            sourceMessageId: messageId,
            caseKey: d.caseKey,
          },
          actionKey,
        );
        return {
          handled: true,
          response: 'Cancelamos este pedido de financiación.',
        };
      }
      const changes = fieldsSchema.parse(
        Object.fromEntries(
          Object.entries(input).filter(([k]) =>
            [
              'name',
              'dni',
              'productSummary',
              'sku',
              'business',
              'purchaseUse',
              'locality',
            ].includes(k),
          ),
        ),
      );
      const changed = Object.entries(changes).some(
        ([k, v]) => d[k as keyof FinancingDraft] !== v,
      );
      if (
        (changes.productSummary &&
          changes.productSummary !== d.productSummary) ||
        (changes.sku && changes.sku !== d.sku)
      ) {
        delete d.confirmedAmount;
        delete d.priceSource;
        delete d.priceConfirmedAt;
        delete d.priceConfirmedById;
        delete d.priceConfirmationNote;
      }
      d = {
        ...d,
        ...changes,
        sourceMessageIds: [...d.sourceMessageIds.slice(-30), messageId],
      };
      if (changes.purchaseUse === 'PERSONAL') delete d.business;
      else if (changes.business) d.purchaseUse = 'BUSINESS';
      if (input.observedAmount)
        d.observedAmount = amountSchema.parse(input.observedAmount);
      const priceChanged = !!price && d.confirmedAmount !== price;
      if (price) {
        delete d.priceConfirmedById;
        delete d.priceConfirmationNote;
        d.confirmedAmount = price;
        d.priceSource = 'STOCK';
        d.priceConfirmedAt = new Date().toISOString();
      }
      if (!active && d.flowVersion === 2 && d.sku && d.productSummary) {
        const prospect = await this.saveDraftProspect(tx, c, d);
        d.prospectId = prospect.id;
      }
      const version = c.financingVersion + 1;
      if (
        this.missing(d).length === 0 &&
        ((d.flowVersion === 2 && !active) ||
          (input.intent === 'CONFIRM' &&
            !changed &&
            !priceChanged &&
            d.stage === 'AWAITING_CONFIRMATION' &&
            d.summaryVersion === c.financingVersion))
      ) {
        const existing = await tx.client.findUnique({
          where: { phone: c.externalId },
        });
        if (existing?.dni && existing.dni !== d.dni) {
          d.stage = 'IDENTITY_CONFLICT';
          delete d.summaryVersion;
          await tx.conversation.update({
            where: { id: c.id },
            data: { financingDraft: this.json(d), financingVersion: version },
          });
          await this.event(
            tx,
            c.id,
            'IDENTITY_CONFLICT',
            {
              sourceMessageId: messageId,
              draftVersion: version,
              caseKey: d.caseKey,
            },
            actionKey,
          );
          return {
            handled: true,
            response:
              'Los datos no coinciden con el registro. Un responsable debe revisar la identidad antes de continuar.',
          };
        }
        const snapshot = {
          purchaseUse: d.purchaseUse ?? (d.business ? 'BUSINESS' : undefined),
          business: d.business,
          locality: d.locality,
          name: d.name!,
          dni: d.dni!,
          productSummary: d.productSummary!,
          sku: d.sku,
          amount: d.confirmedAmount!,
          currency: 'ARS',
          priceSource: d.priceSource!,
          priceConfirmedAt: d.priceConfirmedAt!,
          priceConfirmedById: d.priceConfirmedById,
          conversationId: c.id,
          phone: c.externalId,
          inputVersion: active ? active.version + 1 : 1,
        };
        let requestId: string;
        if (active) {
          await this.correctTx(tx, active, snapshot, undefined, messageId);
          requestId = active.id;
        } else {
          const client =
            existing ||
            (await tx.client.create({
              data: { name: d.name!, dni: d.dni, phone: c.externalId },
            }));
          const prospect = d.prospectId
            ? await tx.prospect.findUniqueOrThrow({
                where: { id: d.prospectId },
              })
            : await this.saveDraftProspect(tx, c, d);
          d.prospectId = prospect.id;
          const startedAt = new Date();
          const req = await tx.purchaseRequest.create({
            data: {
              clientId: client.id,
              conversationId: c.id,
              prospectId: prospect.id,
              productSummary: d.productSummary!,
              amount: d.confirmedAmount!,
              modality: 'FINANCED',
              status: 'PENDING_REVIEW',
              evaluationState: 'PENDING',
              activeKey: `financing:${prospect.id}`,
              inputSnapshot: this.json(snapshot),
              ...(d.flowVersion === 2
                ? {
                    commercialFlow: this.json({
                      version: 2,
                      stage: 'REVIEW',
                      revision: 0,
                      offers: [],
                      startedAt: startedAt.toISOString(),
                      expiresAt: new Date(
                        startedAt.getTime() + OFFER_VALIDITY_MS,
                      ).toISOString(),
                    }),
                  }
                : {}),
            },
          });
          requestId = req.id;
          await tx.conversation.update({
            where: { id: c.id },
            data: { clientId: client.id },
          });
        }
        d.stage = 'SUBMITTED';
        d.purchaseRequestId = requestId;
        d.requestVersion = snapshot.inputVersion;
        delete d.summaryVersion;
        await tx.conversation.update({
          where: { id: c.id },
          data: { financingDraft: this.json(d), financingVersion: version },
        });
        await this.event(
          tx,
          c.id,
          'SUBMITTED',
          {
            requestId,
            requestVersion: snapshot.inputVersion,
            sourceMessageId: messageId,
            caseKey: d.caseKey,
          },
          actionKey,
        );
        return {
          handled: true,
          response:
            d.flowVersion === 2
              ? 'Recibimos tus datos y creamos el pedido de financiación. Administración revisará tu solicitud y habilitará las opciones disponibles. La vigencia del pedido es de 48 horas desde ahora; todavía no está aprobado.'
              : 'Recibimos tu solicitud. Quedó pendiente de la revisión de un supervisor; todavía no es una aprobación.',
        };
      }
      if (changed || priceChanged) delete d.summaryVersion;
      const missing = this.missing(d);
      let response: string;
      if (missing.length) {
        d.stage = 'COLLECTING';
        const labels: Record<string, string> = {
          business: 'saber si la compra es personal o el nombre de tu comercio',
          locality: 'tu localidad',
          name: 'tu nombre',
          dni: 'tu DNI',
          productSummary: 'el producto',
          confirmedAmount: 'el importe confirmado por un responsable',
        };
        response =
          'Para continuar falta ' +
          missing.map((k) => labels[k]).join(', ') +
          '.' +
          (missing.includes('confirmedAmount')
            ? ' Un responsable debe confirmar ese importe.'
            : '');
      } else {
        d.stage = 'AWAITING_CONFIRMATION';
        d.summaryVersion = version;
        response = this.summary(d);
      }
      await tx.conversation.update({
        where: { id: c.id },
        data: { financingDraft: this.json(d), financingVersion: version },
      });
      await this.event(
        tx,
        c.id,
        'DRAFT_UPDATED',
        {
          draftVersion: version,
          requestId: d.purchaseRequestId,
          sourceMessageId: messageId,
          caseKey: d.caseKey,
        },
        actionKey,
      );
      return { handled: true, response };
    });
  }
  private async pending(tx: Tx, id: string, expectedVersion: number) {
    const req = await tx.purchaseRequest.findUnique({ where: { id } });
    if (!req || req.modality !== 'FINANCED')
      throw new NotFoundException('Solicitud no encontrada');
    if (req.status !== 'PENDING_REVIEW')
      throw financingConflict('ALREADY_RESOLVED');
    if (req.version !== expectedVersion)
      throw financingConflict('STALE_VERSION');
    return req;
  }
  private async correctTx(
    tx: Tx,
    req: PurchaseRequest,
    snapshot: any,
    actorId?: string,
    sourceMessageId?: string,
  ) {
    const updated = await tx.purchaseRequest.updateMany({
      where: { id: req.id, status: 'PENDING_REVIEW', version: req.version },
      data: {
        productSummary: snapshot.productSummary,
        amount: snapshot.amount,
        inputSnapshot: this.json(snapshot),
        version: { increment: 1 },
        evaluationState: 'PENDING',
      },
    });
    if (updated.count !== 1) throw financingConflict('STALE_VERSION');
    if (req.prospectId)
      await tx.prospect.update({
        where: { id: req.prospectId },
        data: {
          productInterest: snapshot.productSummary,
          estimatedAmount: snapshot.amount,
          modality: 'FINANCED',
          syncStatus: 'PENDING',
        },
      });
    await this.event(tx, req.conversationId, 'CORRECTED', {
      requestId: req.id,
      requestVersion: req.version + 1,
      actorId,
      sourceMessageId,
    });
  }
  async correct(id: string, dto: any, actorId: string) {
    this.userInput(fieldsSchema, {
      name: dto.name,
      dni: dto.dni,
      productSummary: dto.productSummary,
      ...(dto.sku ? { sku: dto.sku } : {}),
    });
    this.userInput(amountSchema, dto.amount);
    if (!dto.confirmData || !dto.note?.trim())
      throw new BadRequestException('Confirmación y nota obligatorias');
    await this.prisma.$transaction(async (tx) => {
      const req = await this.pending(tx, id, dto.expectedVersion);
      if (req.commercialFlow)
        throw new ConflictException(
          'Modificá este pedido desde su ficha comercial para conservar entrega, ofertas y aceptación.',
        );
      const c = req.conversationId
        ? await tx.conversation.findUnique({
            where: { id: req.conversationId },
          })
        : null;
      if (
        !c ||
        !['WHATSAPP', 'WEB'].includes(c.channel) ||
        !/^\+?\d{8,15}$/.test(c.externalId)
      )
        throw financingConflict(
          'IDENTITY_CONFLICT',
          'Requiere un hilo WhatsApp original válido.',
        );
      let prospectId = req.prospectId;
      if (!prospectId) {
        const prospect = await tx.prospect.create({
          data: {
            phone: c.externalId,
            name: dto.name,
            productInterest: dto.productSummary,
            modality: 'FINANCED',
            estimatedAmount: dto.amount,
            conversationId: c.id,
            syncStatus: 'PENDING',
          },
        });
        prospectId = prospect.id;
      }
      const snapshot = {
        name: dto.name,
        dni: dto.dni,
        productSummary: dto.productSummary,
        sku: dto.sku,
        amount: dto.amount,
        currency: 'ARS',
        priceSource: 'SUPERVISOR',
        priceConfirmedById: actorId,
        priceConfirmedAt: new Date().toISOString(),
        conversationId: c.id,
        phone: c.externalId,
        inputVersion: req.version + 1,
      };
      await this.correctTx(tx, { ...req, prospectId }, snapshot, actorId);
      await tx.purchaseRequest.update({
        where: { id },
        data: { prospectId, activeKey: `financing:${prospectId}` },
      });
    });
    return this.detail(id);
  }
  async review(
    id: string,
    dto: {
      expectedVersion: number;
      decision: 'APPROVED' | 'REJECTED';
      note?: string;
    },
    actorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const req = await this.pending(tx, id, dto.expectedVersion);
      if (req.commercialFlow)
        throw new ConflictException(
          'Revisá las ofertas desde la ficha comercial del pedido.',
        );
      if (!req.inputSnapshot)
        throw financingConflict('LEGACY_CONFIRMATION_REQUIRED');
      if (req.evaluationState !== 'READY')
        throw financingConflict('EVALUATION_PENDING');
      if (!req.amount || req.amount.lte(0))
        throw new BadRequestException('Monto positivo obligatorio');
      const assessment = await tx.creditAssessment.findUnique({
        where: {
          purchaseRequestId_requestVersion: {
            purchaseRequestId: id,
            requestVersion: req.version,
          },
        },
      });
      if (!assessment) throw financingConflict('EVALUATION_PENDING');
      if (
        (['APPROVED_WITH_CONDITIONS', 'UNAVAILABLE'].includes(
          assessment.verdict,
        ) ||
          assessment.verdict !== dto.decision) &&
        !dto.note?.trim()
      )
        throw new BadRequestException('Nota obligatoria para esta decisión');
      const changed = await tx.purchaseRequest.updateMany({
        where: {
          id,
          version: req.version,
          status: 'PENDING_REVIEW',
          evaluationState: 'READY',
        },
        data: {
          status: dto.decision,
          version: { increment: 1 },
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNote: dto.note?.trim() || null,
          reviewedSnapshot: req.inputSnapshot,
          activeKey: null,
        },
      });
      if (changed.count !== 1) throw financingConflict('STALE_VERSION');
      if (!req.conversationId) throw financingConflict('IDENTITY_CONFLICT');
      await tx.outboundCommunication.create({
        data: {
          purchaseRequestId: id,
          conversationId: req.conversationId,
          dedupeKey: `financing-decision:${id}:${req.version + 1}`,
          body: financingNoticeBody(dto.decision),
          transportMode: this.config.get(
            'FINANCING_NOTICE_TRANSPORT',
            'disabled',
          ),
        },
      });
      await this.event(tx, req.conversationId, 'DECIDED', {
        requestId: id,
        requestVersion: req.version + 1,
        actorId,
      });
    });
    return this.get(id);
  }
  async cancel(
    id: string,
    dto: { expectedVersion: number; note?: string },
    actorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const req = await this.pending(tx, id, dto.expectedVersion);
      const result = await tx.purchaseRequest.updateMany({
        where: { id, version: req.version, status: 'PENDING_REVIEW' },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
          cancelledAt: new Date(),
          cancelledById: actorId,
          activeKey: null,
        },
      });
      if (result.count !== 1) throw financingConflict('STALE_VERSION');
      await this.event(tx, req.conversationId, 'CANCELLED', {
        requestId: id,
        requestVersion: req.version + 1,
        actorId,
      });
    });
    return this.get(id);
  }
  private project(row: any) {
    if (!row) return row;
    const { outboundCommunications, ...rest } = row;
    return {
      ...rest,
      legacyNeedsConfirmation:
        row.status === 'PENDING_REVIEW' && !row.inputSnapshot,
      notice: outboundCommunications?.[0] ?? null,
    };
  }
  async createPlan(id: string, dto: CreateFinancingPlanDto, actorId: string) {
    if (!dto.note?.trim())
      throw new BadRequestException(
        'Indicá las condiciones acordadas del plan.',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PurchaseRequest" WHERE id = ${id} FOR UPDATE`;
      const req = await tx.purchaseRequest.findUnique({ where: { id } });
      if (!req) throw new NotFoundException('Solicitud no encontrada');
      if (req.commercialFlow)
        throw new ConflictException(
          'Las cuotas de este pedido se registran junto con el cierre desde Ventas.',
        );
      if (
        req.modality !== 'FINANCED' ||
        req.status !== 'APPROVED' ||
        !req.closedAt ||
        !req.amount ||
        req.amount.lte(0)
      )
        throw new ConflictException(
          'Primero se debe aprobar la financiación y registrar el cierre de la venta.',
        );
      if (req.version !== dto.expectedVersion)
        throw financingConflict('STALE_VERSION');
      const schedule = weeklyPlan(req.amount, dto.quotaCount, dto.firstDueDate);
      const existing = await tx.financing.findUnique({
        where: { purchaseRequestId: id },
        include: { quotas: { orderBy: { number: 'asc' } } },
      });
      if (existing) {
        if (
          existing.quotaCount !== dto.quotaCount ||
          existing.collectorId !== dto.collectorId ||
          existing.quotas[0]?.dueDate.toISOString().slice(0, 10) !==
            dto.firstDueDate
        )
          throw new ConflictException(
            'La solicitud ya tiene un plan registrado. No se puede reemplazar desde esta acción.',
          );
        return existing;
      }
      const collector = await tx.employee.findFirst({
        where: {
          id: dto.collectorId,
          isActive: true,
          sector: { name: 'Cobranzas' },
        },
      });
      if (!collector)
        throw new BadRequestException('Elegí un cobrador activo de Cobranzas.');
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${req.clientId} FOR UPDATE`;
      const client = await tx.client.findUniqueOrThrow({
        where: { id: req.clientId },
      });
      if (
        client.assignedCollectorId &&
        client.assignedCollectorId !== dto.collectorId
      )
        throw new ConflictException(
          'El cliente ya tiene otro cobrador. Usá ese responsable o reasigná la cartera desde Cobranzas.',
        );
      const plan = await tx.financing.create({
        data: {
          purchaseRequestId: id,
          totalAmount: req.amount,
          quotaCount: dto.quotaCount,
          collectorId: dto.collectorId,
          quotas: {
            create: schedule.map((q) => ({ ...q, clientId: req.clientId })),
          },
        },
        include: { quotas: { orderBy: { number: 'asc' } } },
      });
      if (!client.assignedCollectorId)
        await tx.client.update({
          where: { id: req.clientId },
          data: { assignedCollectorId: dto.collectorId },
        });
      await this.event(tx, req.conversationId, 'PLAN_CREATED', {
        requestId: id,
        requestVersion: req.version,
        actorId,
        financingId: plan.id,
        quotaCount: dto.quotaCount,
        firstDueDate: dto.firstDueDate,
        collectorId: dto.collectorId,
        note: dto.note.trim(),
      });
      return plan;
    });
  }

  async list() {
    return (
      await this.prisma.purchaseRequest.findMany({
        where: { modality: 'FINANCED' },
        select: financingSelection,
        orderBy: { createdAt: 'desc' },
      })
    ).map((r) => this.project(r));
  }
  async get(id: string) {
    const row = await this.prisma.purchaseRequest.findUnique({
      where: { id, modality: 'FINANCED' },
      select: financingSelection,
    });
    if (!row) throw new NotFoundException();
    return this.project(row);
  }
  async detail(id: string) {
    const raw = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (raw?.commercialFlow) await this.commercial?.revalidate(id);
    const request = await this.get(id);
    const assessments = await this.prisma.creditAssessment.findMany({
      where: { purchaseRequestId: id },
      select: {
        verdict: true,
        reason: true,
        source: true,
        createdAt: true,
        requestVersion: true,
        inputSnapshot: true,
        rawPayload: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const messages = request.conversationId
      ? await this.prisma.message.findMany({
          where: {
            conversationId: request.conversationId,
            role: { in: ['USER', 'ASSISTANT'] },
          },
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
            outboundCommunication: { select: { id: true } },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const events = await this.prisma.orchestrationEvent.findMany({
      where: {
        conversationId: request.conversationId || 'none',
        eventType: { startsWith: 'FINANCING_' },
      },
      orderBy: { createdAt: 'asc' },
    });
    const linkedCaseKey = (
      events.find(
        (e) =>
          e.eventType === 'FINANCING_SUBMITTED' &&
          (e.payload as any).requestId === id,
      )?.payload as any
    )?.caseKey;
    const plan = await this.prisma.financing.findUnique({
      where: { purchaseRequestId: id },
      include: {
        collector: { select: { id: true, name: true } },
        quotas: { orderBy: { number: 'asc' } },
      },
    });
    return {
      request,
      plan,
      assessments: assessments.map(({ rawPayload, ...a }) => ({
        ...a,
        ...((rawPayload as any)?.commercialCondition
          ? { commercialCondition: (rawPayload as any).commercialCondition }
          : {}),
      })),
      messages: messages.map(({ outboundCommunication, ...m }) => ({
        ...m,
        ...(outboundCommunication
          ? { noticeId: outboundCommunication.id }
          : {}),
      })),
      events: events
        .filter(
          (e) =>
            (e.payload as any).requestId === id ||
            (linkedCaseKey && (e.payload as any).caseKey === linkedCaseKey),
        )
        .map((e) => {
          const p = e.payload as any;
          return {
            id: e.id,
            eventType: e.eventType,
            createdAt: e.createdAt,
            ...Object.fromEntries(
              ['requestVersion', 'actorId', 'sourceMessageId', 'errorCode']
                .filter((k) => p[k] !== undefined)
                .map((k) => [k, p[k]]),
            ),
          };
        }),
    };
  }
}
