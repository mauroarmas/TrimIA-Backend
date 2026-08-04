import { Logger } from '@nestjs/common';
import { buildRagAgentGraph } from './rag-agent.graph';
import { OrchestratorStateType } from '../../orchestrator/orchestrator.state';

/**
 * Tests del flujo compartido de los agentes RAG (Sprint 3 — human-in-the-loop).
 * Verifica que la rama de baja confianza cree un caso pendiente real en vez
 * de solo devolver un mensaje canned (comportamiento anterior a Sprint 3).
 */
describe('buildRagAgentGraph — escalate_to_human', () => {
  const baseState: OrchestratorStateType = {
    message: '¿tienen la heladera en 12 cuotas?',
    conversationId: 'conv-1',
    currentAgent: 'SALES',
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

  it('crea un caso pendiente vía escalations.create() cuando la confianza cae bajo el umbral', async () => {
    const knowledge = {
      search: jest.fn().mockResolvedValue([{ content: 'algo poco relacionado', score: 0.3 }]),
    };
    const llm = { chat: { invoke: jest.fn() } };
    const escalations = {
      create: jest.fn().mockResolvedValue({ id: 'esc-1', status: 'PENDING' }),
    };

    const graph = buildRagAgentGraph(
      { agentType: 'SALES', prompt: 'sos el agente de ventas' },
      {
        llm: llm as any,
        knowledge: knowledge as any,
        confidenceThreshold: 0.65,
        logger: new Logger('test'),
        escalations: escalations as any,
      },
    );

    const result = await graph.invoke(baseState);

    expect(escalations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        reason: expect.stringContaining('0.3'),
      }),
    );
    expect(result.escalated).toBe(true);
    // La confianza fue baja → nunca debió llamarse a Gemini para generar respuesta.
    expect(llm.chat.invoke).not.toHaveBeenCalled();
  });

  it('NO escala si la confianza supera el umbral (camino feliz sin cambios)', async () => {
    const knowledge = {
      search: jest.fn().mockResolvedValue([{ content: 'sí, 12 cuotas sin interés', score: 0.8 }]),
    };
    const llm = {
      chat: {
        invoke: jest.fn().mockResolvedValue({
          content: 'Sí, la tenemos en 12 cuotas.',
          usage_metadata: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    };
    const escalations = { create: jest.fn() };

    const graph = buildRagAgentGraph(
      { agentType: 'SALES', prompt: 'sos el agente de ventas' },
      {
        llm: llm as any,
        knowledge: knowledge as any,
        confidenceThreshold: 0.65,
        logger: new Logger('test'),
        escalations: escalations as any,
      },
    );

    const result = await graph.invoke(baseState);

    expect(escalations.create).not.toHaveBeenCalled();
    expect(result.escalated).toBeFalsy();
    expect(result.response).toBe('Sí, la tenemos en 12 cuotas.');
  });
});
