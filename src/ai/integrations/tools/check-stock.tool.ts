import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchCatalog, CATALOG_PAGE_SIZE } from '../catalog-page';
import { StockPort } from '../ports/stock.port';

export function createCheckStockTool(stockPort: StockPort) {
  return tool(
    async ({ query, offset = 0 }) => {
      try {
        const matches = searchCatalog(await stockPort.listCatalog(), query);
        if (matches.length > 1) {
          const start = offset < matches.length ? offset : 0;
          return JSON.stringify({
            tipo: 'catalogo',
            fuente: 'Inventario conectado',
            total: matches.length,
            offset: start,
            hayMas: start + CATALOG_PAGE_SIZE < matches.length,
            siguienteOffset:
              start + CATALOG_PAGE_SIZE < matches.length
                ? start + CATALOG_PAGE_SIZE
                : null,
            productos: matches
              .slice(start, start + CATALOG_PAGE_SIZE)
              .map((item) => ({
                producto: item.name,
                sku: item.sku,
                stock: item.stock,
                precioLista: item.listPrice,
                precioContado: item.cashPrice,
                enlaceWeb: item.urlCredimision,
                actualizadoEl: item.lastUpdated,
              })),
          });
        }
        const result = await stockPort.checkAvailability(
          matches[0]?.sku || query,
        );
        if (result.available) {
          return JSON.stringify({
            disponible: true,
            fuente:
              result.item.source === 'SIMULATED'
                ? 'Paljet simulado para pruebas'
                : 'Paljet',
            actualizadoEl: result.item.lastUpdated,
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
          fuente:
            result.item.source === 'SIMULATED'
              ? 'Paljet simulado para pruebas'
              : 'Paljet',
          actualizadoEl: result.item.lastUpdated,
          productoConsultado: result.item.name,
          motivo: 'Actualmente sin existencia en depósito',
          alternativasSugeridas: sustitutos,
        });
      } catch (_err: any) {
        return JSON.stringify({
          error: true,
          mensaje: `No se encontró el producto "${query}" en el inventario o catálogo oficial.`,
        });
      }
    },
    {
      name: 'check_stock',
      description:
        'Consulta SIEMPRE esta herramienta para listar productos, modelos, precios o stock del catálogo actual; no uses ejemplos de la base de conocimiento como catálogo completo. Busca familias como heladeras, televisores o balanzas y devuelve hasta 5 opciones por página. Si el cliente pide más opciones, reutilizá la consulta anterior con siguienteOffset. Para un modelo sin stock devuelve hasta 2 sustitutos.',
      schema: z.object({
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Inicio de página; 0 para primera consulta. Usá siguienteOffset de la respuesta previa cuando pidan más opciones.',
          ),
        query: z
          .string()
          .describe(
            'Nombre del producto, modelo o SKU a consultar (ej. "balanza cuora", "cortadora 330")',
          ),
      }),
    },
  );
}
