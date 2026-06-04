import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { AgentType } from '@prisma/client';
import { LlmService } from '../llm/llm.service';
import { AgentsService, SpecializedAgent } from '../agents/agents.service';
import { OrchestrationLogger } from './orchestration-logger.service';
import { OrchestratorState, OrchestratorStateType } from './orchestrator.state';

/**
 * Dominio de cada agente, usado por classify_intent y por el sub-clasificador
 * de scope. Centralizado para no repetir las descripciones.
 */
const AGENT_DOMAINS: Record<SpecializedAgent, string> = {
  SALES:
    'productos, precios de lista, promociones, intención de compra, qué planes de financiación existen',
  ADMIN:
    'verificación crediticia, aprobación de financiación, si un cliente puntual califica para un crédito, validación de documentación, cotización fuera de lista',
  COLLECTIONS:
    'pagos de cuotas, vencimientos, deudas, envío de comprobantes de pago, cuentas corrientes',
  LOGISTICS:
    'envíos, entregas, tiempos de entrega, transporte, despacho de mercadería',
  DEPOSITS:
    'stock, disponibilidad de productos, pedido de fotos o videos de un producto',
};

/**
 * Pre-filtro regex: saludos/despedidas/cortesías obvias que se resuelven sin
 * tocar ningún LLM (costo cero tokens).
 */
const GREETING_RE =
  /^\s*(hola+|buenas|buen[oa]s?\s*(d[ií]as?|tardes|noches)?|hey|holis|que\s*tal|qué\s*tal|cómo\s*andan?|como\s*andan?)\s*[!.¿?]*\s*$/i;
const CLOSING_RE =
  /^\s*(gracias|muchas\s*gracias|mil\s*gracias|ok+|oka+|dale|listo|perfecto|joya|barbaro|bárbaro|chau+|chao|adi[oó]s|nos\s*vemos|hasta\s*luego|👍|🙏|👌)\s*[!.]*\s*$/i;

function isTrivial(message: string): boolean {
  return GREETING_RE.test(message) || CLOSING_RE.test(message);
}

function cannedReply(message: string): string {
  if (CLOSING_RE.test(message)) {
    return '¡Gracias a vos! Cualquier cosa, escribime. 👋';
  }
  return '¡Hola! 👋 ¿En qué puedo ayudarte hoy?';
}

const CLASSIFY_PROMPT = `
  Sos un clasificador de intención para una empresa comercial que vende productos al contado y de forma financiada.

  Leé el mensaje y decidí qué agente especializado debe atenderlo:

  - SALES (Ventas): ${AGENT_DOMAINS.SALES}.
  - ADMIN (Administrativo): ${AGENT_DOMAINS.ADMIN}.
  - COLLECTIONS (Cobranzas): ${AGENT_DOMAINS.COLLECTIONS}.
  - LOGISTICS (Logística): ${AGENT_DOMAINS.LOGISTICS}.
  - DEPOSITS (Depósito): ${AGENT_DOMAINS.DEPOSITS}.
  - greeting: SOLO si el mensaje es un saludo o cortesía sin una consulta concreta.

  Distinción clave: SALES asesora sobre QUÉ productos y planes existen; ADMIN decide si un cliente concreto puede acceder a un crédito o financiación.

  Respondé con la opción más apropiada.
`;

const classificationSchema = z.object({
  intent: z
    .enum(['SALES', 'ADMIN', 'COLLECTIONS', 'LOGISTICS', 'DEPOSITS', 'greeting'])
    .describe('El agente que debe atender el mensaje, o greeting si es un saludo'),
});

const scopeSchema = z.object({
  decision: z
    .enum(['mismo', 'cambio'])
    .describe('mismo = sigue en el dominio del agente actual; cambio = es otro tema'),
});

/**
 * Construye y compila el grafo del orquestador con ruteo sticky (Fase 3.6).
 *
 * Flujo:
 *   START → [entryRouter]
 *     - trivial (regex)        → trivial_response → END        (0 tokens)
 *     - sticky (currentAgent)  → scope_check
 *     - sin agente             → classify_intent
 *   scope_check → [scopeRouter]
 *     - mismo  → <agente actual>
 *     - cambio → handoff_log → classify_intent
 *   classify_intent → [classifyRouter]
 *     - greeting → greeting_response → track_tokens → END
 *     - agente   → <agente>
 *   <agente> → log_event → track_tokens → END
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
    const structured = llm.chat.withStructuredOutput(classificationSchema, {
      name: 'classify_intent',
      includeRaw: true,
    });
    const result = await structured.invoke([
      new SystemMessage(CLASSIFY_PROMPT),
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
      new SystemMessage(
        `El agente actual atiende: ${AGENT_DOMAINS[current]}.\n` +
          `¿El siguiente mensaje sigue siendo de su dominio? Respondé "mismo" o "cambio".`,
      ),
      new HumanMessage(state.message),
    ]);

    const scopeChanged = result.parsed.decision === 'cambio';
    const usage = (result.raw as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;

    logger.log(`[scope ${current}] "${state.message}" → ${result.parsed.decision}`);

    return {
      scopeChanged,
      // Si sigue en el mismo dominio, el agente resuelto es el sticky actual.
      agentType: scopeChanged ? null : state.currentAgent,
      startedAt,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    };
  };

  // --- NODO: handoff_log (cambió el tema → se loguea el handoff) ---
  const handoffLog = async (state: OrchestratorStateType) => {
    await orchestrationLogger.logEvent({
      threadId: state.threadId,
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
      threadId: state.threadId,
      conversationId: state.conversationId,
      eventType: 'ROUTED_TO_AGENT',
      agentType: state.agentType,
      payload: { message: state.message, response: state.response },
    });
    return {};
  };

  // --- NODO: track_tokens (latencia + consumo) ---
  const trackTokens = async (state: OrchestratorStateType) => {
    const durationMs = state.startedAt ? Date.now() - state.startedAt : 0;
    await orchestrationLogger.trackTokens({
      conversationId: state.conversationId,
      agentType: 'ORCHESTRATOR',
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

  // Entrada: regex trivial → sticky (si hay agente) → orquestador.
  const entryRouter = (state: OrchestratorStateType): string => {
    if (isTrivial(state.message)) return 'trivial';
    if (state.currentAgent) return 'sticky';
    return 'orchestrate';
  };

  // Tras scope_check: si sigue en tema va al agente; si cambió, handoff.
  const scopeRouter = (state: OrchestratorStateType): string => {
    return state.scopeChanged ? 'handoff' : (state.currentAgent as string);
  };

  // Tras classify_intent: greeting lo responde el orquestador; si no, al agente.
  const classifyRouter = (state: OrchestratorStateType): string => {
    return state.isGreeting ? 'greeting' : (state.agentType as string);
  };

  const agentKeys: SpecializedAgent[] = [
    'SALES',
    'ADMIN',
    'COLLECTIONS',
    'LOGISTICS',
    'DEPOSITS',
  ];
  const agentMap = Object.fromEntries(agentKeys.map((a) => [a, a]));

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
    // Entrada con pre-filtro regex + sticky.
    .addConditionalEdges(START, entryRouter, {
      trivial: 'trivial_response',
      sticky: 'scope_check',
      orchestrate: 'classify_intent',
    })
    // scope_check → agente (mismo) o handoff (cambio).
    .addConditionalEdges('scope_check', scopeRouter, {
      ...agentMap,
      handoff: 'handoff_log',
    })
    .addEdge('handoff_log', 'classify_intent')
    // classify_intent → agente o greeting.
    .addConditionalEdges('classify_intent', classifyRouter, {
      ...agentMap,
      greeting: 'greeting_response',
    })
    // Cada agente → auditoría + métricas.
    .addEdge('SALES', 'log_event')
    .addEdge('ADMIN', 'log_event')
    .addEdge('COLLECTIONS', 'log_event')
    .addEdge('LOGISTICS', 'log_event')
    .addEdge('DEPOSITS', 'log_event')
    .addEdge('log_event', 'track_tokens')
    // greeting consume tokens del classify → se registran igual.
    .addEdge('greeting_response', 'track_tokens')
    .addEdge('track_tokens', END)
    // El saludo trivial no toca el LLM → termina directo.
    .addEdge('trivial_response', END)
    .compile();
}
