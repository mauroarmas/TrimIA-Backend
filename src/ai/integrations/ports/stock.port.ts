export interface StockItem {
  sku: string;
  name: string;
  category: 'BALANZAS' | 'CORTADORAS' | 'GASTRONOMIA' | 'REFRIGERACION' | 'ACCESORIOS';
  stock: number;
  listPrice: number;        // Precio de lista para cuotas
  cashPrice: number;        // Precio contado efectivo
  substituteSkus: string[]; // SKUs de productos alternativos si stock === 0
  urlCredimision: string;   // Link oficial a la ficha web
  lastUpdated: string;      // ISO string
}

export interface StockCheckResult {
  available: boolean;
  item: StockItem;
  suggestedSubstitutes?: StockItem[]; // Máximo 2 alternativas si stock === 0 (RF09)
}

export const STOCK_PORT = Symbol('STOCK_PORT');

export interface StockPort {
  /**
   * Consulta disponibilidad y precio por SKU o término de búsqueda.
   * Si no hay stock disponible, calcula y retorna hasta 2 productos sustitutos (RF09).
   */
  checkAvailability(skuOrQuery: string, userType?: string): Promise<StockCheckResult>;

  /**
   * Obtiene la lista completa del catálogo para el panel de ventas.
   */
  listCatalog(category?: string): Promise<StockItem[]>;
}

