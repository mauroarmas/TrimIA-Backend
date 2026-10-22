import { MockStockAdapter } from './mock-stock.adapter';

describe('MockStockAdapter', () => {
  let adapter: MockStockAdapter;

  beforeEach(() => {
    adapter = new MockStockAdapter();
  });

  it('debe encontrar un producto por SKU exacto cuando hay stock disponible', async () => {
    const result = await adapter.checkAvailability('BAL-SYS-CUORA');
    expect(result.available).toBe(true);
    expect(result.item.sku).toBe('BAL-SYS-CUORA');
    expect(result.item.stock).toBeGreaterThan(0);
    expect(result.suggestedSubstitutes).toBeUndefined();
  });

  it('debe encontrar un producto por coincidencia parcial de texto en el nombre', async () => {
    const result = await adapter.checkAvailability('cuora');
    expect(result.available).toBe(true);
    expect(result.item.sku).toBe('BAL-SYS-CUORA');
  });

  it('debe cumplir RF09: cuando el stock es 0, sugiere hasta 2 alternativas con stock disponible', async () => {
    const result = await adapter.checkAvailability('COR-MAR-330');
    expect(result.available).toBe(false);
    expect(result.item.sku).toBe('COR-MAR-330');
    expect(result.item.stock).toBe(0);
    expect(result.suggestedSubstitutes).toBeDefined();
    expect(result.suggestedSubstitutes!.length).toBeGreaterThan(0);
    expect(result.suggestedSubstitutes!.length).toBeLessThanOrEqual(2);
    // Todos los sustitutos sugeridos deben tener stock real
    for (const sub of result.suggestedSubstitutes!) {
      expect(sub.stock).toBeGreaterThan(0);
    }
  });

  it('debe listar todo el catálogo y permitir filtrar por categoría', async () => {
    const fullCatalog = await adapter.listCatalog();
    expect(fullCatalog.length).toBeGreaterThanOrEqual(10);

    const balanzas = await adapter.listCatalog('BALANZAS');
    expect(balanzas.every((p) => p.category === 'BALANZAS')).toBe(true);
  });
});

