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
    needsHuman: null,
    handoffReason: null,
    internalNote: null,
    scopeChanged: null,
    isGreeting: null,
    greetingType: null,
    isTrivial: null,
    startedAt: null,
    inputTokens: null,
    outputTokens: null,
  };

  function buildGraph(scopeResult: {
    decision: string;
    isGreeting: boolean;
    greetingType?: string;
  }) {
    const invoke = jest.fn().mockResolvedValue({
      parsed: scopeResult,
      raw: { usage_metadata: { input_tokens: 10, output_tokens: 2 } },
    });
    const llm = {
      chat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
      classifierChat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
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

  /**
   * Bug real (2026-08-06): "si por favor" —confirmando la pregunta que el
   * bot mismo hizo en el turno anterior— se clasificaba como isGreeting=true
   * y la conversación caía en un callejón sin salida sin llegar al agente.
   * Causa: scope_check no recibía el historial, así que una confirmación
   * corta era indistinguible de una cortesía suelta ("dale", "gracias").
   */
  it('scope_check recibe el historial (no solo el mensaje aislado)', async () => {
    const stateWithHistory: OrchestratorStateType = {
      ...baseState,
      message: 'si por favor',
      history: [
        { role: 'USER', content: 'quiero saber si tenes el modelo X' },
        {
          role: 'ASSISTANT',
          content: '¿Querés que derive tu consulta con un responsable?',
        },
      ],
    };
    const { graph, invoke } = buildGraph({ decision: 'mismo', isGreeting: false });

    await graph.invoke(stateWithHistory);

    const messages = invoke.mock.calls[0][0] as Array<{
      content: string;
      _getType: () => string;
    }>;
    // [system, ...history, mensaje actual]
    expect(messages).toHaveLength(4);
    expect(messages[1]._getType()).toBe('human');
    expect(messages[1].content).toBe('quiero saber si tenes el modelo X');
    expect(messages[2]._getType()).toBe('ai');
    expect(messages[2].content).toBe(
      '¿Querés que derive tu consulta con un responsable?',
    );
    expect(messages[3]._getType()).toBe('human');
    expect(messages[3].content).toBe('si por favor');
  });

  it('scope_check funciona igual sin historial (conversación recién empezada)', async () => {
    const { graph, invoke } = buildGraph({ decision: 'mismo', isGreeting: false });

    await graph.invoke(baseState); // baseState.history = []

    const messages = invoke.mock.calls[0][0] as Array<unknown>;
    expect(messages).toHaveLength(2); // [system, mensaje actual]
  });
});

/**
 * Bug real (2026-08-11): el atajo de 0 tokens (isTrivial, por regex) corría
 * ANTES de mirar si había agente sticky. Un "dale"/"listo"/"ok" — que
 * confirma una pregunta que el bot mismo hizo en el turno anterior — caía en
 * trivial_response → END sin pasar nunca por scope_check (que sí tiene el
 * historial para distinguir una confirmación de una cortesía suelta).
 */
describe('buildOrchestratorGraph — atajo trivial vs. agente sticky', () => {
  const baseState: OrchestratorStateType = {
    message: 'dale',
    conversationId: 'conv-1',
    currentAgent: 'COLLECTIONS',
    userType: 'CLIENTE',
    history: [],
    agentType: null,
    response: null,
    context: null,
    confidence: null,
    escalated: null,
    needsHuman: null,
    handoffReason: null,
    internalNote: null,
    scopeChanged: null,
    isGreeting: null,
    greetingType: null,
    isTrivial: null,
    startedAt: null,
    inputTokens: null,
    outputTokens: null,
  };

  function buildGraph(scopeResult: {
    decision: string;
    isGreeting: boolean;
    greetingType?: string;
  }) {
    const invoke = jest.fn().mockResolvedValue({
      parsed: scopeResult,
      raw: { usage_metadata: { input_tokens: 10, output_tokens: 2 } },
    });
    const llm = {
      chat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
      classifierChat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
      model: 'gemini-3.5-flash-lite',
    };
    const collectionsNode = jest
      .fn()
      .mockResolvedValue({ response: 'respuesta de cobranzas', agentType: 'COLLECTIONS' });
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

  it('con agente sticky, "dale" pasa por scope_check (LLM) en vez del atajo regex', async () => {
    const { graph, invoke, collectionsNode } = buildGraph({
      decision: 'mismo',
      isGreeting: false,
    });

    const result = await graph.invoke(baseState);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(collectionsNode).toHaveBeenCalled();
    expect(result.isTrivial).not.toBe(true);
  });

  it('sin agente sticky, "dale" sigue resolviéndose gratis (0 llamadas al LLM)', async () => {
    const { graph, invoke } = buildGraph({ decision: 'mismo', isGreeting: false });

    const result = await graph.invoke({ ...baseState, currentAgent: null });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.isTrivial).toBe(true);
  });
});

/**
 * Bug real (2026-08-11): greeting_response contestaba siempre "¡Hola!" —
 * incluso cuando el mensaje era en realidad un agradecimiento/despedida que
 * no matcheó el regex de isTrivial (ej. "buenísimo, gracias"). Ahora usa
 * greetingType, que sale de la MISMA llamada estructurada que ya decidió
 * isGreeting (sin costo extra de tokens).
 */
describe('buildOrchestratorGraph — greeting_response usa greetingType', () => {
  const baseState: OrchestratorStateType = {
    message: 'buenísimo, gracias!',
    conversationId: 'conv-1',
    currentAgent: 'COLLECTIONS',
    userType: 'CLIENTE',
    history: [],
    agentType: null,
    response: null,
    context: null,
    confidence: null,
    escalated: null,
    needsHuman: null,
    handoffReason: null,
    internalNote: null,
    scopeChanged: null,
    isGreeting: null,
    greetingType: null,
    isTrivial: null,
    startedAt: null,
    inputTokens: null,
    outputTokens: null,
  };

  function buildGraph(scopeResult: {
    decision: string;
    isGreeting: boolean;
    greetingType?: string;
  }) {
    const invoke = jest.fn().mockResolvedValue({
      parsed: scopeResult,
      raw: { usage_metadata: { input_tokens: 10, output_tokens: 2 } },
    });
    const llm = {
      chat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
      classifierChat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
      model: 'gemini-3.5-flash-lite',
    };
    const agents = { getGraph: jest.fn(() => jest.fn().mockResolvedValue({})) };
    const orchestrationLogger = { logEvent: jest.fn(), trackTokens: jest.fn() };

    return buildOrchestratorGraph(
      llm as any,
      agents as any,
      orchestrationLogger as any,
      new Logger('test'),
    );
  }

  it('greetingType "cierre" → respuesta de despedida, no "¡Hola!"', async () => {
    const graph = buildGraph({ decision: 'mismo', isGreeting: true, greetingType: 'cierre' });

    const result = await graph.invoke(baseState);

    expect(result.response).toContain('Gracias a vos');
  });

  it('greetingType "apertura" → respuesta de bienvenida', async () => {
    const graph = buildGraph({ decision: 'mismo', isGreeting: true, greetingType: 'apertura' });

    const result = await graph.invoke(baseState);

    expect(result.response).toContain('¿En qué puedo ayudarte');
  });

  it('sin greetingType (el modelo lo omitió) → default seguro: bienvenida', async () => {
    const graph = buildGraph({ decision: 'mismo', isGreeting: true });

    const result = await graph.invoke(baseState);

    expect(result.response).toContain('¿En qué puedo ayudarte');
  });
});

/**
 * Optimización (2026-08-11): antes, un handoff (cambio de tema con agente
 * sticky) costaba 3 llamadas al LLM: scope_check → classify_intent →
 * generate_response del agente. scope_check ya le pide al modelo el
 * contraste con las otras áreas, así que ahora también puede devolver
 * targetAgent en la misma respuesta y el grafo salta classify_intent.
 */
describe('buildOrchestratorGraph — handoff colapsado (targetAgent de scope_check)', () => {
  const baseState: OrchestratorStateType = {
    message: 'quiero comprar una heladera',
    conversationId: 'conv-1',
    currentAgent: 'COLLECTIONS',
    userType: 'CLIENTE',
    history: [],
    agentType: null,
    response: null,
    context: null,
    confidence: null,
    escalated: null,
    needsHuman: null,
    handoffReason: null,
    internalNote: null,
    scopeChanged: null,
    isGreeting: null,
    greetingType: null,
    isTrivial: null,
    startedAt: null,
    inputTokens: null,
    outputTokens: null,
  };

  function buildSalesAgentMock() {
    return jest
      .fn()
      .mockResolvedValue({ response: 'respuesta de ventas', agentType: 'SALES' });
  }

  it('scope_check trae targetAgent → va directo al agente, sin volver a clasificar (1 sola llamada al LLM)', async () => {
    const invoke = jest.fn().mockResolvedValue({
      parsed: { decision: 'cambio', isGreeting: false, targetAgent: 'SALES' },
      raw: { usage_metadata: { input_tokens: 10, output_tokens: 2 } },
    });
    const withStructuredOutput = jest.fn().mockReturnValue({ invoke });
    const llm = {
      chat: { withStructuredOutput },
      classifierChat: { withStructuredOutput },
      model: 'gemini-3.5-flash-lite',
    };
    const salesNode = buildSalesAgentMock();
    const agents = {
      getGraph: jest.fn((type: string) =>
        type === 'SALES' ? salesNode : jest.fn().mockResolvedValue({}),
      ),
    };
    const orchestrationLogger = { logEvent: jest.fn(), trackTokens: jest.fn() };
    const graph = buildOrchestratorGraph(
      llm as any,
      agents as any,
      orchestrationLogger as any,
      new Logger('test'),
    );

    const result = await graph.invoke(baseState);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(salesNode).toHaveBeenCalled();
    expect(result.response).toBe('respuesta de ventas');
  });

  it('scope_check dice "cambio" pero sin targetAgent → cae a classify_intent como red de seguridad', async () => {
    const invokeScope = jest.fn().mockResolvedValue({
      parsed: { decision: 'cambio', isGreeting: false },
      raw: { usage_metadata: { input_tokens: 10, output_tokens: 2 } },
    });
    const invokeClassify = jest.fn().mockResolvedValue({
      parsed: { intent: 'SALES' },
      raw: { usage_metadata: { input_tokens: 5, output_tokens: 1 } },
    });
    const withStructuredOutput = jest
      .fn()
      .mockReturnValueOnce({ invoke: invokeScope })
      .mockReturnValueOnce({ invoke: invokeClassify });
    const llm = {
      chat: { withStructuredOutput },
      classifierChat: { withStructuredOutput },
      model: 'gemini-3.5-flash-lite',
    };
    const salesNode = buildSalesAgentMock();
    const agents = {
      getGraph: jest.fn((type: string) =>
        type === 'SALES' ? salesNode : jest.fn().mockResolvedValue({}),
      ),
    };
    const orchestrationLogger = { logEvent: jest.fn(), trackTokens: jest.fn() };
    const graph = buildOrchestratorGraph(
      llm as any,
      agents as any,
      orchestrationLogger as any,
      new Logger('test'),
    );

    const result = await graph.invoke(baseState);

    expect(invokeScope).toHaveBeenCalledTimes(1);
    expect(invokeClassify).toHaveBeenCalledTimes(1);
    expect(salesNode).toHaveBeenCalled();
    expect(result.response).toBe('respuesta de ventas');
  });
});

/**
 * Bug real (2026-08-11): trivial_response iba directo a END, sin pasar por
 * log_event ni track_tokens — un saludo/cierre trivial no dejaba ningún
 * rastro (ni ConversationEvent ni TokenUsage), invisible para la auditoría.
 */
describe('buildOrchestratorGraph — trivial_response deja auditoría', () => {
  it('un mensaje trivial pasa por log_event (eventType TRIVIAL_RESPONSE) y track_tokens', async () => {
    const llm = {
      chat: { withStructuredOutput: jest.fn() },
      classifierChat: { withStructuredOutput: jest.fn() },
      model: 'gemini-3.5-flash-lite',
    };
    const agents = { getGraph: jest.fn(() => jest.fn().mockResolvedValue({})) };
    const logEvent = jest.fn();
    const trackTokens = jest.fn();
    const orchestrationLogger = { logEvent, trackTokens };
    const graph = buildOrchestratorGraph(
      llm as any,
      agents as any,
      orchestrationLogger as any,
      new Logger('test'),
    );

    const state: OrchestratorStateType = {
      message: 'hola',
      conversationId: 'conv-1',
      currentAgent: null,
      userType: 'CLIENTE',
      history: [],
      agentType: null,
      response: null,
      context: null,
      confidence: null,
      escalated: null,
      needsHuman: null,
      handoffReason: null,
      internalNote: null,
      scopeChanged: null,
      isGreeting: null,
      greetingType: null,
      isTrivial: null,
      startedAt: null,
      inputTokens: null,
      outputTokens: null,
    };

    await graph.invoke(state);

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0]).toMatchObject({ eventType: 'TRIVIAL_RESPONSE' });
    expect(trackTokens).toHaveBeenCalledTimes(1);
    expect(trackTokens.mock.calls[0][0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});
