import { z } from 'zod';

const price = z.number().finite().nonnegative().nullable();
const item = z.object({
  producto: z.string().min(1),
  sku: z.string().min(1),
  precioLista: price,
  precioContado: price,
  stock: z.number().int().nonnegative(),
});
const stockSchema = z.union([
  item.extend({
    disponible: z.literal(true),
    fuente: z.string(),
    actualizadoEl: z.string().datetime(),
  }),
  z.object({
    disponible: z.literal(false),
    fuente: z.string(),
    actualizadoEl: z.string().datetime(),
    productoConsultado: z.string().min(1),
    alternativasSugeridas: z.array(item).max(2),
  }),
]);
const creditSchema = z.object({
  verdict: z.enum(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED']),
  commercialCondition: z.string().min(1),
  evaluatedAt: z.string().datetime(),
});

export interface IntegrationEvidence {
  hasFacts: boolean;
  stockPrices: number[];
  creditVerdict?: string;
}
export function integrationEvidence(
  name: string,
  output: unknown,
): IntegrationEvidence {
  let data: unknown;
  try {
    data = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return { hasFacts: false, stockPrices: [] };
  }
  if (name === 'check_stock') {
    const parsed = stockSchema.safeParse(data);
    if (parsed.success) {
      const items =
        'alternativasSugeridas' in parsed.data
          ? parsed.data.alternativasSugeridas
          : [parsed.data];
      return {
        hasFacts: true,
        stockPrices: items
          .flatMap((i) => [i.precioLista, i.precioContado])
          .filter((p): p is number => typeof p === 'number'),
      };
    }
  }
  if (name === 'evaluate_credit') {
    const parsed = creditSchema.safeParse(data);
    if (parsed.success)
      return {
        hasFacts: true,
        stockPrices: [],
        creditVerdict: parsed.data.verdict,
      };
  }
  return { hasFacts: false, stockPrices: [] };
}
