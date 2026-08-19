import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  BaseMessage,
  SystemMessage,
  HumanMessage,
  AIMessage,
} from '@langchain/core/messages';
import { AgentType } from '@prisma/client';
import { ConversationTurn } from '../../conversations/conversations.service';
import { LlmService } from '../llm/llm.service';
import { AgentsService, SpecializedAgent } from '../agents/agents.service';
import { OrchestrationLogger } from './orchestration-logger.service';
import { OrchestratorState, OrchestratorStateType } from './orchestrator.state';
import {
  buildClassifyPrompt,
  buildScopePrompt,
} from './utils/orchestrator.prompts';
import {
  buildClassificationSchema,
  buildScopeSchema,
} from './utils/orchestrator.schemas';
import {
  isTrivial,
  isUntranscribableAudio,
  cannedReply,
  OPENING_REPLY,
  CLOSING_REPLY,
} from './utils/trivial-filter';
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
 *     - trivial (regex), SOLO sin sticky → trivial_response → log_event → track_tokens → END (0 tokens)
 *     - sticky (currentAgent)  → scope_check
 *     - sin agente             → classify_intent
 *   scope_check → [scopeRouter]
 *     - mismo + greeting     → greeting_response → track_tokens → END
 *     - mismo, no greeting   → <agente actual>
 *     - cambio               → handoff_log → [postHandoffRouter]
 *   handoff_log → [postHandoffRouter]
 *     - targetAgent resuelto por scope_check → <agente>            (1 llamada, no 2)
 *     - sin targetAgent (red de seguridad)   → classify_intent
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
    // temperature 0: es una decisión de ruteo, no generación — tiene que ser
    // estable (mismo mensaje → mismo agente en cada corrida).
    const structured = llm.classifierChat.withStructuredOutput(
      buildClassificationSchema(allowed),
      { name: 'classify_intent', includeRaw: true },
    );
    const result = await structured.invoke([
      new SystemMessage(buildClassifyPrompt(allowed)),
      new HumanMessage(state.message),
    ]);

    if (!result.parsed) {
      throw new Error(
        `classify_intent: Gemini no devolvió salida estructurada válida para "${state.message}"`,
      );
    }

    const intent = result.parsed.intent;
    const usage = (result.raw as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    const isGreeting = intent === 'greeting';

    logger.log(`"${state.message}" → ${intent}`);

    return {
      agentType: isGreeting ? null : (intent as AgentType),
      isGreeting,
      greetingType: isGreeting
        ? (result.parsed.greetingType ?? 'apertura')
        : null,
      startedAt,
      inputTokens: (state.inputTokens ?? 0) + (usage?.input_tokens ?? 0),
      outputTokens: (state.outputTokens ?? 0) + (usage?.output_tokens ?? 0),
    };
  };

  // --- NODO: scope_check (sub-clasificador del agente sticky) ---
  const scopeCheck = async (state: OrchestratorStateType) => {
    const startedAt = Date.now();
    const current = state.currentAgent as SpecializedAgent;
    const allowed = allowedAgentsFor(state.userType);
    // Sin el historial, una confirmación corta ("si por favor") a una
    // pregunta que el bot mismo hizo en el turno anterior es indistinguible
    // de una cortesía suelta ("dale", "gracias") — el modelo la marcaba
    // isGreeting=true y la conversación caía en un callejón sin salida
    // (greeting_response → END), sin llegar nunca al agente. Mismo patrón
    // de historyMessages que ya usa generate_response en rag-agent.graph.ts.
    const historyMessages: BaseMessage[] = (state.history ?? []).map(
      (turn: ConversationTurn) =>
        turn.role === 'USER'
          ? new HumanMessage(turn.content)
          : new AIMessage(turn.content),
    );
    // temperature 0, mismo criterio que classify_intent: es ruteo, no generación.
    const structured = llm.classifierChat.withStructuredOutput(
      buildScopeSchema(allowed),
      { name: 'scope_check', includeRaw: true },
    );
    const result = await structured.invoke([
      new SystemMessage(buildScopePrompt(current, allowed)),
      ...historyMessages,
      new HumanMessage(state.message),
    ]);

    if (!result.parsed) {
      throw new Error(
        `scope_check: Gemini no devolvió salida estructurada válida para "${state.message}"`,
      );
    }

    const scopeChanged = result.parsed.decision === 'cambio';
    const isGreeting = result.parsed.isGreeting;
    // Si el propio scope_check ya identificó a qué agente corresponde el
    // cambio de tema, se lo usamos directo y nos ahorramos volver a pasar
    // por classify_intent (ver handoffLog/postHandoffRouter).
    const targetAgent = result.parsed.targetAgent as AgentType | undefined;
    const usage = (result.raw as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;

    logger.log(
      `[scope ${current}] "${state.message}" → ${result.parsed.decision}` +
        (isGreeting ? ' (greeting)' : '') +
        (scopeChanged && targetAgent ? ` → ${targetAgent}` : ''),
    );

    return {
      scopeChanged,
      isGreeting,
      greetingType: isGreeting
        ? (result.parsed.greetingType ?? 'apertura')
        : null,
      // Si sigue en el mismo dominio y no es un saludo, el agente resuelto
      // es el sticky actual. Un saludo nunca resuelve a un agente, igual que
      // en classify_intent (ver scopeRouter). Si cambió de tema, resuelve al
      // targetAgent si el modelo lo dio; si no (o es greeting), null — y
      // postHandoffRouter cae de nuevo a classify_intent como red de seguridad.
      agentType: isGreeting
        ? null
        : scopeChanged
          ? (targetAgent ?? null)
          : state.currentAgent,
      startedAt,
      // Acumula igual que classify_intent (no pisa): hoy scope_check siempre
      // es el primer nodo LLM del turno cuando corre, así que da lo mismo —
      // pero si alguna vez deja de serlo, pisar perdería tokens ya contados.
      inputTokens: (state.inputTokens ?? 0) + (usage?.input_tokens ?? 0),
      outputTokens: (state.outputTokens ?? 0) + (usage?.output_tokens ?? 0),
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
    // A diferencia de trivial_response, acá el mensaje YA falló el regex de
    // isTrivial — por eso lo clasificó el LLM. greetingType sale de la misma
    // llamada estructurada que decidió isGreeting (classify_intent/scope_check),
    // así que no adivinamos con un regex que ya sabemos que no matchea.
    return {
      response: state.greetingType === 'cierre' ? CLOSING_REPLY : OPENING_REPLY,
    };
  };

  // --- NODO: log_event (auditoría del ruteo a agente, o del trivial) ---
  const logEvent = async (state: OrchestratorStateType) => {
    await orchestrationLogger.logEvent({
      conversationId: state.conversationId,
      // trivial_response también pasa por acá (antes no dejaba rastro:
      // ni ConversationEvent ni TokenUsage, invisible para la auditoría).
      //
      // El audio no transcribible sale por el mismo nodo pero con su propio
      // tipo: contarlo como TRIVIAL_RESPONSE lo escondería entre los saludos,
      // y cuán seguido falla la transcripción es justamente lo que hay que
      // poder medir para saber si el canal de voz sirve (OE-11).
      eventType: isUntranscribableAudio(state.message)
        ? 'AUDIO_NOT_TRANSCRIBED'
        : state.isTrivial
          ? 'TRIVIAL_RESPONSE'
          : 'ROUTED_TO_AGENT',
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
    // Audio que n8n no pudo transcribir (US5, FR-009). Va ANTES del sticky y
    // sin la guarda de `!state.currentAgent` que sí lleva isTrivial: acá no
    // hay ambigüedad que resolver con el historial — no existe mensaje del
    // usuario, existe un aviso de que la transcripción falló. Mandarlo al
    // LLM sería pedirle que responda un texto que nadie escribió, y con
    // agente fijado terminaría escalando a una persona por un audio que
    // simplemente no se entendió.
    if (isUntranscribableAudio(state.message)) return 'trivial';

    // El atajo de 0 tokens solo es seguro sin agente sticky: con un agente
    // fijado, un "dale"/"listo"/"ok" corto puede ser la confirmación a una
    // pregunta que el bot mismo hizo en el turno anterior (mismo callejón sin
    // salida que motivó pasarle el historial a scope_check — ver su comentario).
    // El regex no tiene forma de distinguirlo, así que con sticky siempre pasa
    // por scope_check, que sí tiene el historial para decidir bien.
    if (!state.currentAgent && isTrivial(state.message)) return 'trivial';

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

  // scope_check ya devolvió targetAgent (ver comentario en scopeCheck): si lo
  // trajo, se salta classify_intent y va directo al agente. Si no (o quedó
  // ambiguo), classify_intent actúa de red de seguridad, como antes.
  const postHandoffRouter = (state: OrchestratorStateType): string =>
    state.agentType ? (state.agentType as string) : 'classify_intent';

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
    .addConditionalEdges('handoff_log', postHandoffRouter, {
      ...agentMap,
      classify_intent: 'classify_intent',
    })
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
    .addEdge('trivial_response', 'log_event')
    .addEdge('track_tokens', END)
    .compile();
}
