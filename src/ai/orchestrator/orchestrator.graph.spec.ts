import { Logger } from '@nestjs/common';
import { buildOrchestratorGraph } from './orchestrator.graph';
import { OrchestratorStateType } from './orchestrator.state';

/**
 * Ruteo sticky vs. greeting (bug encontrado revisando el diagrama de
 * arquitectura). classify_intent y classifyRouter evalúan isGreeting; el
 * camino sticky-mismo-tema (scope_check → scopeRouter) NO lo hacía y entraba
 * directo al agente aunque el mensaje fuera mayormente una cortesía.
 */
describe('buildOrchestratorGraph — ruteo sticky vs. greeting', () => {
  const baseState: OrchestratorStateType = {
    message: 'buenísimo, gracias! y la cuota 3 cuándo vence?',
    conversationId: 'conv-1',
    currentAgent: 'COLLECTIONS',
    userType: 'CLIENTE',
    history: [],
    agentType: null,
    response: null,
    context: null,
    confidence: null,
    escalated: null,
    scopeChanged: null,
    isGreeting: null,
    isTrivial: null,
    startedAt: null,
    inputTokens: null,
    outputTokens: null,
  };

  function buildGraph(scopeResult: { decision: string; isGreeting: boolean }) {
    const invoke = jest.fn().mockResolvedValue({
      parsed: scopeResult,
      raw: { usage_metadata: { input_tokens: 10, output_tokens: 2 } },
    });
    const llm = {
      chat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
      model: 'gemini-3.5-flash-lite',
    };
    const collectionsNode = jest
      .fn()
      .mockResolvedValue({ response: 'respuesta del agente de cobranzas', agentType: 'COLLECTIONS' });
    const agents = {
      getGraph: jest.fn((type: string) =>
        type === 'COLLECTIONS' ? collectionsNode : jest.fn().mockResolvedValue({}),
      ),
    };
    const orchestrationLogger = { logEvent: jest.fn(), trackTokens: jest.fn() };

    const graph = buildOrchestratorGraph(
      llm as any,
      agents as any,
      orchestrationLogger as any,
      new Logger('test'),
    );
    return { graph, collectionsNode, invoke };
  }

  it('sticky + mismo tema + mensaje mayormente saludo → resuelve como greeting, NO entra al agente', async () => {
    const { graph, collectionsNode } = buildGraph({ decision: 'mismo', isGreeting: true });

    const result = await graph.invoke(baseState);

    expect(collectionsNode).not.toHaveBeenCalled();
    expect(result.agentType).toBeNull();
  });

  it('sticky + mismo tema + NO es saludo → sigue yendo directo al agente (sin cambios de comportamiento)', async () => {
    const { graph, collectionsNode } = buildGraph({ decision: 'mismo', isGreeting: false });

    const result = await graph.invoke(baseState);

    expect(collectionsNode).toHaveBeenCalled();
    expect(result.response).toBe('respuesta del agente de cobranzas');
  });

  it('scope_check sigue haciendo UNA sola llamada a Gemini (el greeting sale "gratis" de la misma respuesta estructurada)', async () => {
    const { graph, invoke } = buildGraph({ decision: 'mismo', isGreeting: true });

    await graph.invoke(baseState);

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
