import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { AgentType } from '@prisma/client';
import { LlmService } from '../llm/llm.service';
import { AgentsService, SpecializedAgent } from '../agents/agents.service';
import { OrchestrationLogger } from './orchestration-logger.service';
import { OrchestratorState, OrchestratorStateType } from './orchestrator.state';
import { buildClassifyPrompt, buildScopePrompt } from './utils/orchestrator.prompts';
import { buildClassificationSchema, scopeSchema } from './utils/orchestrator.schemas';
import { isTrivial, cannedReply } from './utils/trivial-filter';
import { allowedAgentsFor } from '../agents/agent-domains';

const AGENT_KEYS: SpecializedAgent[] = [
  'SALES',
  'ADMIN',
  'COLLECTIONS',
  'LOGISTICS',
  'DEPOSITS',
];

/**
 * Construye y compila el grafo del orquestador con ruteo sticky (Fase 3.6).
 *
 * Flujo:
 *   START → [entryRouter]
 *     - trivial (regex)        → trivial_response → END        (0 tokens)
 *     - sticky (currentAgent)  → scope_check
 *     - sin agente             → classify_intent
 *   scope_check → [scopeRouter]
 *     - mismo + greeting     → greeting_response → track_tokens → END
 *     - mismo, no greeting   → <agente actual>
 *     - cambio               → handoff_log → classify_intent
 *   classify_intent → [classifyRouter]
 *     - greeting → greeting_response → track_tokens → END
 *     - agente   → <agente>
 *   <agente> → log_event → track_tokens → END
 *
 * Los contenidos (prompts, schemas, regex) viven en archivos aparte:
 *   orchestrator.prompts.ts · orchestrator.schemas.ts · trivial-filter.ts
 */


export function buildOrchestratorGraph(
  llm: LlmService,
  agents: AgentsService,
  orchestrationLogger: OrchestrationLogger,
  logger: Logger,
) {
  // --- NODO: classify_intent (orquestador con Gemini) ---
  const classifyIntent = async (state: OrchestratorStateType) => {
    const startedAt = state.startedAt ?? Date.now();
    // Solo se ofrecen los agentes permitidos para este tipo de usuario.
    const allowed = allowedAgentsFor(state.userType);
    const structured = llm.chat.withStructuredOutput(
      buildClassificationSchema(allowed),
      { name: 'classify_intent', includeRaw: true },
    );
    const result = await structured.invoke([
      new SystemMessage(buildClassifyPrompt(allowed)),
      new HumanMessage(state.message),
    ]);

    const intent = result.parsed.intent;
    const usage = (result.raw as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    const isGreeting = intent === 'greeting';

    logger.log(`"${state.message}" → ${intent}`);

    return {
      agentType: isGreeting ? null : (intent as AgentType),
      isGreeting,
      startedAt,
      inputTokens: (state.inputTokens ?? 0) + (usage?.input_tokens ?? 0),
      outputTokens: (state.outputTokens ?? 0) + (usage?.output_tokens ?? 0),
    };
  };

  // --- NODO: scope_check (sub-clasificador del agente sticky) ---
  const scopeCheck = async (state: OrchestratorStateType) => {
    const startedAt = Date.now();
    const current = state.currentAgent as SpecializedAgent;
    const structured = llm.chat.withStructuredOutput(scopeSchema, {
      name: 'scope_check',
      includeRaw: true,
    });
    const result = await structured.invoke([
      new SystemMessage(buildScopePrompt(current)),
      new HumanMessage(state.message),
    ]);

    const scopeChanged = result.parsed.decision === 'cambio';
    const isGreeting = result.parsed.isGreeting;
    const usage = (result.raw as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;

    logger.log(
      `[scope ${current}] "${state.message}" → ${result.parsed.decision}` +
        (isGreeting ? ' (greeting)' : ''),
    );

    return {
      scopeChanged,
      isGreeting,
      // Si sigue en el mismo dominio y no es un saludo, el agente resuelto
      // es el sticky actual. Un saludo nunca resuelve a un agente, igual que
      // en classify_intent (ver scopeRouter).
      agentType: scopeChanged || isGreeting ? null : state.currentAgent,
      startedAt,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    };
  };

  // --- NODO: handoff_log (cambió el tema → se loguea el handoff) ---
  const handoffLog = async (state: OrchestratorStateType) => {
    await orchestrationLogger.logEvent({
      conversationId: state.conversationId,
      eventType: 'agent_handoff',
      agentType: state.currentAgent,
      payload: { message: state.message, from: state.currentAgent },
    });
    logger.log(`[handoff] saliendo de ${state.currentAgent} → reclasificar`);
    return {};
  };

  // --- NODO: respuesta a saludo trivial (sin LLM) ---
  const trivialResponse = async (state: OrchestratorStateType) => {
    logger.log(`[trivial] "${state.message}" → respuesta canned`);
    return { response: cannedReply(state.message), isTrivial: true };
  };

  // --- NODO: respuesta a greeting no trivial (lo resuelve el orquestador) ---
  const greetingResponse = async (state: OrchestratorStateType) => {
    return { response: cannedReply(state.message) };
  };

  // --- NODO: log_event (auditoría del ruteo a agente) ---
  const logEvent = async (state: OrchestratorStateType) => {
    await orchestrationLogger.logEvent({
      conversationId: state.conversationId,
      eventType: 'ROUTED_TO_AGENT',
      agentType: state.agentType,
      payload: {
        message: state.message,
        response: state.response,
        // Confianza del RAG y si se derivó a humano: alimentan el estado de
        // agentes del Panel del Supervisor (GET /supervisor/agents/status).
        confidence: state.confidence ?? null,
        escalated: state.escalated ?? false,
      },
    });
    return {};
  };

  // --- NODO: track_tokens (latencia + consumo) ---
  const trackTokens = async (state: OrchestratorStateType) => {
    const durationMs = state.startedAt ? Date.now() - state.startedAt : 0;
    await orchestrationLogger.trackTokens({
      conversationId: state.conversationId,
      // Atribuye el costo total del turno al agente resuelto (o al orquestador
      // si fue un saludo/greeting sin agente).
      agentType: state.agentType ?? 'ORCHESTRATOR',
      inputTokens: state.inputTokens ?? 0,
      outputTokens: state.outputTokens ?? 0,
      durationMs,
      model: llm.model,
    });
    logger.log(
      `Tokens in=${state.inputTokens} out=${state.outputTokens} (${durationMs}ms)`,
    );
    return {};
  };

  // --- ROUTERS (funciones puras, sin costo de tokens) ---

  const entryRouter = (state: OrchestratorStateType): string => {
    if (isTrivial(state.message)) return 'trivial';
    
    // Sticky solo si el agente fijado sigue permitido para este usuario.
    // (auto-sana conversaciones pegadas a un agente no permitido, p. ej. un
    // cliente que quedó en DEPOSITS por datos previos → vuelve a clasificar.)
    const allowed = allowedAgentsFor(state.userType);
    if (
      state.currentAgent &&
      allowed.includes(state.currentAgent as SpecializedAgent)
    ) {
      return 'sticky';
    }
    return 'orchestrate';
  };

  const scopeRouter = (state: OrchestratorStateType): string => {
    if (state.scopeChanged) return 'handoff';
    // Mismo dominio, pero el mensaje es mayormente un saludo/cortesía: no
    // tiene sentido gastar el turno completo del agente RAG por esto (mismo
    // criterio que classifyRouter para la rama sin agente sticky).
    if (state.isGreeting) return 'greeting';
    return state.currentAgent as string;
  };

  const classifyRouter = (state: OrchestratorStateType): string => {
    return state.isGreeting ? 'greeting' : (state.agentType as string);
  };

  const agentMap = Object.fromEntries(AGENT_KEYS.map((a) => [a, a]));

  // --- Armado del grafo ---
  return new StateGraph(OrchestratorState)
    .addNode('classify_intent', classifyIntent)
    .addNode('scope_check', scopeCheck)
    .addNode('handoff_log', handoffLog)
    .addNode('trivial_response', trivialResponse)
    .addNode('greeting_response', greetingResponse)
    .addNode('SALES', agents.getGraph('SALES'))
    .addNode('ADMIN', agents.getGraph('ADMIN'))
    .addNode('COLLECTIONS', agents.getGraph('COLLECTIONS'))
    .addNode('LOGISTICS', agents.getGraph('LOGISTICS'))
    .addNode('DEPOSITS', agents.getGraph('DEPOSITS'))
    .addNode('log_event', logEvent)
    .addNode('track_tokens', trackTokens)
    .addConditionalEdges(START, entryRouter, {
      trivial: 'trivial_response',
      sticky: 'scope_check',
      orchestrate: 'classify_intent',
    })
    .addConditionalEdges('scope_check', scopeRouter, {
      ...agentMap,
      handoff: 'handoff_log',
      greeting: 'greeting_response',
    })
    .addEdge('handoff_log', 'classify_intent')
    .addConditionalEdges('classify_intent', classifyRouter, {
      ...agentMap,
      greeting: 'greeting_response',
    })
    .addEdge('SALES', 'log_event')
    .addEdge('ADMIN', 'log_event')
    .addEdge('COLLECTIONS', 'log_event')
    .addEdge('LOGISTICS', 'log_event')
    .addEdge('DEPOSITS', 'log_event')
    .addEdge('log_event', 'track_tokens')
    .addEdge('greeting_response', 'track_tokens')
    .addEdge('track_tokens', END)
    .addEdge('trivial_response', END)
    .compile();
}
