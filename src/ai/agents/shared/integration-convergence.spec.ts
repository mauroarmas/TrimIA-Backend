import { buildRagAgentGraph } from './rag-agent.graph';
import { createCheckStockTool } from '../../integrations/tools/check-stock.tool';
import { createSaveProspectTool } from '../../integrations/tools/save-prospect.tool';
import { MockStockAdapter } from '../../integrations/adapters/mock-stock.adapter';

const logger: any = { log: jest.fn(), warn: jest.fn() };
describe('Grafos: evidencia de integraciones y resumen comercial', () => {
  function fixture(
    tools: any[],
    calls: any[],
    parsed: any = { response: 'Respuesta', needsHuman: false },
    score = 0,
  ) {
    const generate = jest.fn(async () => ({ parsed, raw: {} }));
    const select = jest.fn(async () => ({ tool_calls: calls }));
    const deps: any = {
      llm: {
        chat: {
          bindTools: () => ({ invoke: select }),
          withStructuredOutput: () => ({ invoke: generate }),
        },
      },
      knowledge: {
        search: async () =>
          score
            ? [
                {
                  content: 'Procedimiento autorizado',
                  score,
                  documentId: 'd1',
                  title: 'Procedimiento',
                },
              ]
            : [],
      },
      confidenceThreshold: 0.7,
      logger,
      escalations: { create: jest.fn(async () => ({ id: 'case-1' })) },
    };
    const graph = buildRagAgentGraph(
      { agentType: 'SALES', prompt: 'Ventas', tools },
      deps,
    );
    return { deps, graph, generate };
  }
  it('error de producto no eleva confianza ni habilita generación con RAG vacío', async () => {
    const f = fixture(
      [createCheckStockTool(new MockStockAdapter())],
      [{ name: 'check_stock', args: { query: 'Producto inexistente xyz' } }],
    );
    const result = await f.graph.invoke({
      message: 'stock',
      conversationId: 'c1',
      history: [],
      userType: 'CLIENTE',
    });
    expect(result.confidence).toBe(0);
    expect(result.escalated).toBe(true);
    expect(f.generate).not.toHaveBeenCalled();
  });
  it('un acuse de guardado no aporta reglas ni precios', async () => {
    const f = fixture(
      [
        {
          name: 'save_prospect',
          invoke: async () => JSON.stringify({ exito: true, id: 'p1' }),
        },
      ],
      [{ name: 'save_prospect', args: {} }],
    );
    const result = await f.graph.invoke({
      message: 'Consulta de planes desconocidos',
      conversationId: 'c1',
      history: [],
      userType: 'CLIENTE',
    });
    expect(result.escalated).toBe(true);
    expect(f.generate).not.toHaveBeenCalled();
  });
  it('stock válido permite contestar sin alterar la confianza medida de RAG', async () => {
    const f = fixture(
      [createCheckStockTool(new MockStockAdapter())],
      [{ name: 'check_stock', args: { query: 'BAL-SYS-CUORA' } }],
    );
    const result = await f.graph.invoke({
      message: 'stock',
      history: [],
      userType: 'CLIENTE',
    });
    expect(f.generate).toHaveBeenCalled();
    expect(result.confidence).toBe(0);
    expect(result.integrationEvidence.hasFacts).toBe(true);
  });
  it('valida y persiste el resumen en la nota del escalado sin precio inventado', async () => {
    const f = fixture(
      [],
      [],
      {
        response: 'Derivo al vendedor.',
        needsHuman: true,
        salesHandoff: {
          producto: 'Balanza',
          precioEstimado: 999999,
          modalidad: 'CASH',
          estadoCredito: 'APPROVED',
          motivoAlerta: 'Solicitud del cliente',
        },
      },
      0.85,
    );
    const result = await f.graph.invoke({
      message: 'Quiero hablar con un vendedor',
      conversationId: 'c1',
      history: [],
      userType: 'CLIENTE',
    });
    const note = JSON.parse(
      f.deps.escalations.create.mock.calls[0][0].internalNote,
    );
    expect(note.type).toBe('SALES_HANDOFF');
    expect(note).not.toHaveProperty('precioEstimado');
    expect(note).not.toHaveProperty('estadoCredito');
    expect(result.escalated).toBe(true);
  });
  it('no acepta teléfono o conversación del modelo al guardar el prospecto', async () => {
    const crm: any = {
      searchProspect: jest.fn(async () => null),
      createProspect: jest.fn(async () => ({
        success: true,
        id: 'p1',
        remoteSynced: false,
      })),
    };
    const tool = createSaveProspectTool(crm);
    await tool.invoke(
      {
        name: 'Ana',
        product: 'Equipo',
        modality: 'CASH',
        phone: 'INVENTADO',
        conversationId: 'otro',
      } as any,
      {
        configurable: {
          contact: { phone: '5491111111111', conversationId: 'real' },
        },
      },
    );
    expect(crm.createProspect.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        telefono: '5491111111111',
        conversationId: 'real',
      }),
    );
    crm.createProspect.mockClear();
    await tool.invoke({ name: 'Ana', product: 'Equipo', modality: 'CASH' });
    expect(crm.createProspect).not.toHaveBeenCalled();
  });
});
