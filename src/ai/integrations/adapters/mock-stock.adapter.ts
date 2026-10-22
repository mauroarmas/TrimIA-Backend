import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StockCheckResult, StockItem, StockPort } from '../ports/stock.port';
import { PALJET_CATALOG_SEED } from '../seeds/paljet-catalog.seed';

@Injectable()
export class MockStockAdapter implements StockPort {
  private readonly logger = new Logger(MockStockAdapter.name);
  private catalog: StockItem[] = [...PALJET_CATALOG_SEED];

  async checkAvailability(skuOrQuery: string, _userType?: string): Promise<StockCheckResult> {
    const q = skuOrQuery.trim().toLowerCase();
    
    // Búsqueda por SKU exacto o coincidencia en nombre
    let found = this.catalog.find(
      (item) => item.sku.toLowerCase() === q || item.name.toLowerCase().includes(q),
    );

    if (!found) {
      throw new NotFoundException(`Producto "${skuOrQuery}" no encontrado en el catálogo de Paljet`);
    }

    const available = found.stock > 0;

    // Regla RF09: Si no hay stock, buscar hasta 2 sustitutos definidos que tengan stock > 0
    let suggestedSubstitutes: StockItem[] | undefined;
    if (!available && found.substituteSkus && found.substituteSkus.length > 0) {
      suggestedSubstitutes = this.catalog
        .filter((item) => found!.substituteSkus.includes(item.sku) && item.stock > 0)
        .slice(0, 2);
    }

    this.logger.log(
      `Consulta stock "${found.sku}": disponibles=${found.stock}, disponible=${available}, sustitutos=${suggestedSubstitutes?.length ?? 0}`,
    );

    return {
      available,
      item: found,
      suggestedSubstitutes,
    };
  }

  async listCatalog(category?: string): Promise<StockItem[]> {
    if (!category) return [...this.catalog];
    return this.catalog.filter(
      (item) => item.category.toUpperCase() === category.toUpperCase(),
    );
  }
}

