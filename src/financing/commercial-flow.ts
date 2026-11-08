import { Prisma } from '@prisma/client';
import { StockItem } from '../ai/integrations/ports/stock.port';

export const OFFER_VALIDITY_MS = 48 * 60 * 60 * 1000;
export type CommercialOffer = {
  id: string;
  label: string;
  modality: 'CASH' | 'FINANCED';
  total: string;
  quotaCount: number;
  frequency: 'WEEKLY' | null;
  collectorId?: string;
  firstDueDate?: string;
};
export type CommercialFlow = {
  version: 2;
  stage: 'REVIEW' | 'CHOOSING' | 'READY' | 'CLOSED';
  startedAt: string;
  expiresAt: string;
  revision: number;
  offers: CommercialOffer[];
  selectedOfferId?: string;
  deliveryMode?: 'PICKUP' | 'SHIPPING';
  deliveryAddress?: string;
  contactName?: string;
  contactPhone?: string;
  shippingCost?: string;
  acceptedRevision?: number;
  acceptedMessageId?: string;
  summaryMessageId?: string;
  reviewReason?: string;
};
export const asCommercialFlow = (value: unknown): CommercialFlow | null =>
  value && (value as CommercialFlow).version === 2
    ? (value as CommercialFlow)
    : null;
export const normalizeCommercial = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** Condiciones ficticias de la demo, habilitadas expresamente por Administración. */
export function mockOffers(
  item: StockItem,
  confirmedAmount?: string,
): CommercialOffer[] {
  const list =
    item.listPrice ?? (confirmedAmount ? Number(confirmedAmount) : null);
  const offers: CommercialOffer[] = [];
  if (item.cashPrice && item.cashPrice > 0)
    offers.push({
      id: 'cash',
      label: 'Contado',
      modality: 'CASH',
      total: new Prisma.Decimal(item.cashPrice).toFixed(2),
      quotaCount: 0,
      frequency: null,
    });
  if (list && list > 0)
    for (const count of [12, 24])
      offers.push({
        id: `weekly-${count}`,
        label: `${count} cuotas semanales`,
        modality: 'FINANCED',
        total: new Prisma.Decimal(list).toFixed(2),
        quotaCount: count,
        frequency: 'WEEKLY',
      });
  return offers;
}
export const MOCK_DELIVERY = [
  { locality: 'Posadas', cost: '15000.00' },
  { locality: 'Garupá', cost: '18000.00' },
  { locality: 'Oberá', cost: '35000.00' },
];
export function deliveryFor(locality: string) {
  return MOCK_DELIVERY.find(
    (row) =>
      normalizeCommercial(row.locality) === normalizeCommercial(locality),
  );
}
export function offerText(offer: CommercialOffer) {
  const money = (value: string) =>
    Number(value).toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS',
    });
  if (offer.modality === 'CASH') return `Contado: ${money(offer.total)}`;
  const base = new Prisma.Decimal(offer.total)
    .div(offer.quotaCount)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const last = new Prisma.Decimal(offer.total).minus(
    base.mul(offer.quotaCount - 1),
  );
  return `${offer.label}: ${offer.quotaCount - 1} de ${money(base.toFixed(2))} y última de ${money(last.toFixed(2))}; total ${money(offer.total)}. Primer vencimiento: ${offer.firstDueDate}`;
}
export const futureFirstDue = (value?: string, now = new Date()) =>
  !!value &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T15:00:00Z`).getTime() > now.getTime() &&
  new Date(`${value}T15:00:00Z`).toISOString().slice(0, 10) === value;
