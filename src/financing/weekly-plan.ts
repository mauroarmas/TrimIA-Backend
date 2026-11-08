import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Reparte el total confirmado en centavos, sin intereses ni redondeos flotantes. */
export function weeklyPlan(
  total: Prisma.Decimal | string,
  count: number,
  firstDueDate: string,
) {
  const amount = new Prisma.Decimal(total);
  const start = new Date(firstDueDate + 'T15:00:00.000Z');
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 260 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate) ||
    !Number.isFinite(start.getTime()) ||
    start.toISOString().slice(0, 10) !== firstDueDate ||
    !amount.isFinite() ||
    amount.lte(0) ||
    amount.decimalPlaces() > 2
  ) {
    throw new BadRequestException(
      'Revisá el total, la cantidad de cuotas y la fecha del primer vencimiento.',
    );
  }
  const cents = BigInt(amount.mul(100).toFixed(0));
  const base = cents / BigInt(count);
  if (base < 1n)
    throw new BadRequestException('Cada cuota debe tener un importe positivo.');
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    amount: new Prisma.Decimal(
      (index === count - 1
        ? cents - base * BigInt(count - 1)
        : base
      ).toString(),
    ).div(100),
    dueDate: new Date(start.getTime() + index * 7 * 86400000),
  }));
}
