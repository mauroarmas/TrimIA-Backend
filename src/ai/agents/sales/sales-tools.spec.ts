import { buildSalesGraph } from './sales.graph';
import { MockStockAdapter } from '../../integrations/adapters/mock-stock.adapter';
import { AIMessage } from '@langchain/core/messages';

describe('SalesGraph - Integrations and Tools', () => {
  let stockAdapter: MockStockAdapter;

  const mockLlmService = {
    chat: {
      bindTools: jest.fn().mockReturnValue({
        invoke: jest.fn().mockResolvedValue({
          tool_calls: [
            {
              name: 'check_stock',
              args: { query: 'cortadora 330' },
            },
          ],
        }),
      }),
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke: jest.fn().mockResolvedValue({
          parsed: {
            response:
              'La cortadora Marani 330mm no cuenta con stock inmediato, pero disponemos de la Trinidad 300mm a $580.000 y la Berkley 300mm a $610.000. Podés ver los detalles en https://credimision.com.ar/productos/cortadoras/trinidad-300mm 🙌',
            needsHuman: false,
          },
          raw: new AIMessage({
            content: 'test',
            usage_metadata: { input_tokens: 120, output_tokens: 45 },
          }),
        }),
      }),
    },
  };

  const mockKnowledgeService = {
    search: jest.fn().mockResolvedValue([]),
  };

  const mockEscalationsService = {
    create: jest.fn(),
  };

  beforeEach(() => {
    stockAdapter = new MockStockAdapter();
  });

  it('debe invocar check_stock e incluir las alternativas con enlaces oficiales en la respuesta', async () => {
    const deps: any = {
      llm: mockLlmService,
      knowledge: mockKnowledgeService,
      confidenceThreshold: 0.65,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      escalations: mockEscalationsService,
      stockPort: stockAdapter,
    };

    const graph = buildSalesGraph(deps);
    const result = await graph.invoke({
      message: '¿Tienen stock de la cortadora de 330mm?',
      userType: 'CLIENTE',
      caller: null,
      history: [],
    });

    expect(result.response).toContain('Trinidad 300mm');
    expect(result.response).toContain('https://credimision.com.ar');
    expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    expect(result.needsHuman).toBe(false);
  });
});

