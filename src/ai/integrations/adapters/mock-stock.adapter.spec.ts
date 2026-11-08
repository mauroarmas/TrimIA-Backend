import { MockStockAdapter } from './mock-stock.adapter';

describe('MockStockAdapter', () => {
  let adapter: MockStockAdapter;

  beforeEach(() => {
    adapter = new MockStockAdapter();
  });

  it('incluye los tres Smart TV definidos por RF09-01, con precios desconocidos explícitos', async () => {
    const items = await adapter.listCatalog('Smart TV');
    expect(items.slice(0, 3).map((item) => [item.name, item.stock])).toEqual([
      ['Smart TV Samsung 55" 4K', 4],
      ['Smart TV LG 50" Full HD', 1],
      ['Smart TV Philips 43"', 0],
    ]);
    expect(
      items
        .slice(0, 3)
        .every(
          (item) => item.source === 'SIMULATED' && item.cashPrice === null,
        ),
    ).toBe(true);
    const unavailable = await adapter.checkAvailability('Philips 43');
    expect(unavailable.available).toBe(false);
    expect(unavailable.suggestedSubstitutes).toHaveLength(2);
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
