import { formatCatalogPage } from '../../integrations/catalog-page';
import { z } from 'zod';

const price = z.number().finite().nonnegative().nullable();
const item = z.object({
  producto: z.string().min(1),
  sku: z.string().min(1),
  precioLista: price,
  precioContado: price,
  stock: z.number().int().nonnegative(),
});
const catalogSchema = z.object({
  tipo: z.literal('catalogo'),
  total: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hayMas: z.boolean(),
  productos: z
    .array(
      item.extend({
        enlaceWeb: z.string().nullable(),
        actualizadoEl: z.string().datetime(),
      }),
    )
    .min(1)
    .max(5),
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
  catalogReply?: string;
  selectionReply?: string;
}
export function integrationEvidence(
  name: string,
  output: unknown,
  selectedSku?: string,
): IntegrationEvidence {
  let data: unknown;
  try {
    data = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return { hasFacts: false, stockPrices: [] };
  }
  if (name === 'check_stock') {
    const catalog = catalogSchema.safeParse(data);
    if (catalog.success) {
      const page = catalog.data;
      const rows = page.productos.map((i) => ({
        sku: i.sku,
        name: i.producto,
        category: 'ACCESORIOS' as const,
        stock: i.stock,
        listPrice: i.precioLista,
        cashPrice: i.precioContado,
        substituteSkus: [],
        urlCredimision: i.enlaceWeb,
        lastUpdated: i.actualizadoEl,
      }));
      // El formateador recibe solo la página validada; los metadatos indican si hay más.
      let reply = formatCatalogPage(rows);
      reply = reply.replace(
        /^(\d+)\./gm,
        (_, n) => `${Number(n) + page.offset}.`,
      );
      if (page.hayMas)
        reply = reply.replace(
          '\n¿Cuál modelo',
          '\nTengo más opciones. Si querés verlas, decime «mostrame más». ¿Cuál modelo',
        );
      return {
        hasFacts: true,
        stockPrices: rows
          .flatMap((i) => [i.listPrice, i.cashPrice])
          .filter((p): p is number => typeof p === 'number'),
        catalogReply: reply,
      };
    }
    const parsed = stockSchema.safeParse(data);
    if (parsed.success) {
      const items =
        'alternativasSugeridas' in parsed.data
          ? parsed.data.alternativasSugeridas
          : [parsed.data];
      return {
        hasFacts: true,
        ...(selectedSku &&
        'sku' in parsed.data &&
        parsed.data.sku === selectedSku &&
        parsed.data.precioLista !== null &&
        parsed.data.precioContado !== null
          ? {
              selectionReply: `Elegiste ${parsed.data.producto}. Está disponible. Precio de lista: $${parsed.data.precioLista.toLocaleString('es-AR')}; contado: $${parsed.data.precioContado.toLocaleString('es-AR')}. ¿Preferís pagar de contado o solicitar financiación?`,
            }
          : {}),
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
