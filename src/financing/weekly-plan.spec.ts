import { weeklyPlan } from './weekly-plan';
import { Prisma } from '@prisma/client';
describe('cuotas semanales del total aprobado', () => {
  it('conserva centavos, total y fecha local al distribuir un importe indivisible', () => {
    const rows = weeklyPlan('100.00', 3, '2026-11-13');
    expect(rows.map((q) => q.amount.toFixed(2))).toEqual([
      '33.33',
      '33.33',
      '33.34',
    ]);
    expect(rows.map((q) => q.dueDate.toISOString().slice(0, 10))).toEqual([
      '2026-11-13',
      '2026-11-20',
      '2026-11-27',
    ]);
    expect(
      rows
        .reduce((sum, q) => sum.add(q.amount), new Prisma.Decimal(0))
        .toFixed(2),
    ).toBe('100.00');
  });
  it.each([
    ['100', 0, '2026-11-13'],
    ['100', 261, '2026-11-13'],
    ['100', 1.5, '2026-11-13'],
    ['100', 2, '2026-02-30'],
    ['100', 2, '2026-11-xx'],
    ['0.01', 2, '2026-11-13'],
    ['0', 1, '2026-11-13'],
    ['-1', 1, '2026-11-13'],
    ['100.001', 2, '2026-11-13'],
  ])('rechaza plan inválido %p / %p / %p', (total, count, date) =>
    expect(() =>
      weeklyPlan(total as string, count as number, date as string),
    ).toThrow(),
  );
});
