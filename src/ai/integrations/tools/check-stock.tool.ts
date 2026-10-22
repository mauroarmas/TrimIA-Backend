import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { StockPort } from '../ports/stock.port';

export function createCheckStockTool(stockPort: StockPort) {
  return tool(
    async ({ query }) => {
      try {
        const result = await stockPort.checkAvailability(query);
        if (result.available) {
          return JSON.stringify({
            disponible: true,
            producto: result.item.name,
            sku: result.item.sku,
            precioLista: result.item.listPrice,
            precioContado: result.item.cashPrice,
            stock: result.item.stock,
            enlaceWeb: result.item.urlCredimision,
          });
        }

        // Sin stock disponible: incluir sustitutos
        const sustitutos = (result.suggestedSubstitutes || []).map((sub) => ({
          producto: sub.name,
          sku: sub.sku,
          precioLista: sub.listPrice,
          precioContado: sub.cashPrice,
          stock: sub.stock,
          enlaceWeb: sub.urlCredimision,
        }));

        return JSON.stringify({
          disponible: false,
          productoConsultado: result.item.name,
          motivo: 'Actualmente sin existencia en depósito',
          alternativasSugeridas: sustitutos,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: true,
          mensaje: `No se encontró el producto "${query}" en el inventario o catálogo oficial.`,
        });
      }
    },
    {
      name: 'check_stock',
      description:
        'Consulta disponibilidad, existencias reales y precios de maquinarias comerciales o gastronómicas. Si no hay stock disponible, retorna automáticamente hasta 2 productos sustitutos con stock.',
      schema: z.object({
        query: z.string().describe('Nombre del producto, modelo o SKU a consultar (ej. "balanza cuora", "cortadora 330")'),
      }),
    },
  );
}

