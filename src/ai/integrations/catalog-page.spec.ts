import { MockStockAdapter } from './adapters/mock-stock.adapter';
import { createCheckStockTool } from './tools/check-stock.tool';
import { integrationEvidence } from '../agents/shared/integration-evidence';

describe('Páginas del catálogo actual', () => {
  const tool = createCheckStockTool(new MockStockAdapter());
  it('incluye las tres heladeras y las presenta en lista', async () => {
    const result = await tool.invoke({ query: 'heladeras' });
    const data = JSON.parse(result);
    expect(data.productos).toHaveLength(3);
    expect(data.productos.map((i) => i.sku)).toContain('EXH-INH-600');
    const evidence = integrationEvidence('check_stock', result);
    expect(evidence.hasFacts).toBe(true);
    expect(evidence.catalogReply).toMatch(/1\..*Briket/);
    expect(evidence.catalogReply).toMatch(/\n3\..*600/);
    expect(evidence.catalogReply).not.toMatch(/Tengo más/);
  });
  it('limita la página a cinco y ofrece los restantes sin repetir', async () => {
    const first = JSON.parse(await tool.invoke({ query: 'televisores' }));
    expect(first.productos).toHaveLength(5);
    expect(first.total).toBe(9);
    expect(first.siguienteOffset).toBe(5);
    const evidence = integrationEvidence('check_stock', JSON.stringify(first));
    expect(evidence.catalogReply).toMatch(/Tengo más opciones/);
    expect(evidence.catalogReply).not.toMatch(/\n6\./);
    const next = JSON.parse(
      await tool.invoke({ query: 'televisores', offset: 5 }),
    );
    expect(next.productos).toHaveLength(4);
    expect(next.hayMas).toBe(false);
    expect(
      next.productos.every(
        (i) => !first.productos.some((j) => i.sku === j.sku),
      ),
    ).toBe(true);
    expect(
      integrationEvidence('check_stock', JSON.stringify(next)).catalogReply,
    ).toMatch(/\n6\./);
  });
  it('conserva la consulta de modelo sin stock y sus dos sustitutos', async () => {
    const data = JSON.parse(await tool.invoke({ query: 'COR-MAR-330' }));
    expect(data.disponible).toBe(false);
    expect(data.alternativasSugeridas).toHaveLength(2);
  });
});
