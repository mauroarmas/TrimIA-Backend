import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import { AgentsService, SpecializedAgent } from '../agents/agents.service';
import { OrchestrationLogger } from './orchestration-logger.service';
import { OrchestratorState, OrchestratorStateType } from './orchestrator.state';

/**
 * Prompt que le dice a Gemini cómo clasificar el mensaje.
 * Contexto: empresa comercial que vende productos al contado y financiados.
 */
const CLASSIFY_PROMPT = `
  Sos un clasificador de intención para una empresa comercial que vende productos al contado y de forma financiada.

  Tu tarea es leer el mensaje del cliente y decidir qué agente especializado debe atenderlo:

  - SALES (Ventas): consultas sobre productos, precios de lista, promociones, intención de compra, qué planes de financiación existen.
  - ADMIN (Administrativo): verificación crediticia, aprobación de financiación, si un cliente puntual califica para un crédito, validación de documentación, cotización de productos que no están en la lista de precios.
  - COLLECTIONS (Cobranzas): pagos de cuotas, vencimientos, deudas, envío de comprobantes de pago, cuentas corrientes.
  - LOGISTICS (Logística): envíos, entregas, tiempos de entrega, transporte, despacho de mercadería.
  - DEPOSITS (Depósito): stock, disponibilidad de productos, pedido de fotos o videos de un producto.

  Distinción clave: SALES asesora sobre QUÉ productos y planes existen; ADMIN decide si un cliente concreto puede acceder a un crédito o financiación.

  Respondé con el agente más apropiado para el mensaje.
`;

/**
 * Esquema de la respuesta de Gemini. Al usar withStructuredOutput,
 * el modelo está OBLIGADO a devolver exactamente uno de estos valores.
 * No hay que parsear texto libre — viene tipado y validado.
 */
const classificationSchema = z.object({
  agentType: z
    .enum(['SALES', 'ADMIN', 'COLLECTIONS', 'LOGISTICS', 'DEPOSITS'])
    .describe('El agente especializado que debe atender el mensaje'),
});

/**
 * Construye y compila el grafo del orquestador.
 * Se llama UNA sola vez (en onModuleInit del service).
 *
 * Por ahora el grafo tiene un solo nodo:
 *   [START] → classify_intent → [END]
 *
 * En el paso 3.4 le agregaremos el routing hacia los agentes.
 */
export function buildOrchestratorGraph(
  llm: LlmService,
  agents: AgentsService,
  orchestrationLogger: OrchestrationLogger,
  logger: Logger,
) {
  // --- NODO: classify_intent ---
  // Un nodo es una función que recibe el state y devuelve una parte actualizada.
  const classifyIntent = async (state: OrchestratorStateType) => {
    const startedAt = Date.now(); // marca el inicio para calcular durationMs

    // withStructuredOutput fuerza a Gemini a responder con el esquema zod.
    // includeRaw: true → además del valor parseado, devuelve el mensaje crudo
    // (que trae usage_metadata con el conteo de tokens).
    const structured = llm.chat.withStructuredOutput(classificationSchema, {
      name: 'classify_intent',
      includeRaw: true,
    });

    const result = await structured.invoke([
      new SystemMessage(CLASSIFY_PROMPT),
      new HumanMessage(state.message),
    ]);

    const agentType = result.parsed.agentType;
    const usage = (result.raw as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;

    logger.log(`"${state.message}" → ${agentType}`);

    // Lo que devuelve el nodo se mergea al state
    return {
      agentType,
      startedAt,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    };
  };

  // --- FUNCIÓN DE RUTEO (la usa la flecha condicional) ---
  // Lee el agentType que dejó classify_intent y devuelve a qué nodo ir.
  const routeToAgent = (state: OrchestratorStateType): SpecializedAgent => {
    return state.agentType as SpecializedAgent;
  };

  // --- NODO: log_event ---
  // Persiste en Prisma qué pasó (auditoría para Paperclip).
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

  // --- NODO: track_tokens ---
  // Calcula la latencia total y persiste el consumo de tokens.
  const trackTokens = async (state: OrchestratorStateType) => {
    const durationMs = state.startedAt ? Date.now() - state.startedAt : 0;
    await orchestrationLogger.trackTokens({
      conversationId: state.conversationId,
      agentType: 'ORCHESTRATOR', // la clasificación la hace el orquestador
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

  // --- Armado del grafo ---
  return new StateGraph(OrchestratorState)
    .addNode('classify_intent', classifyIntent)
    // Cada agente (subgrafo ya compilado) se agrega como un nodo del grafo principal.
    // Comparten el mismo State, así que el agente lee 'message' y escribe 'response'.
    .addNode('SALES', agents.getGraph('SALES'))
    .addNode('ADMIN', agents.getGraph('ADMIN'))
    .addNode('COLLECTIONS', agents.getGraph('COLLECTIONS'))
    .addNode('LOGISTICS', agents.getGraph('LOGISTICS'))
    .addNode('DEPOSITS', agents.getGraph('DEPOSITS'))
    // Nodos finales comunes: registran auditoría y métricas.
    .addNode('log_event', logEvent)
    .addNode('track_tokens', trackTokens)
    .addEdge(START, 'classify_intent')
    // Flecha condicional: routeToAgent devuelve una clave, y el mapa de abajo
    // dice a qué nodo corresponde esa clave.
    .addConditionalEdges('classify_intent', routeToAgent, {
      SALES: 'SALES',
      ADMIN: 'ADMIN',
      COLLECTIONS: 'COLLECTIONS',
      LOGISTICS: 'LOGISTICS',
      DEPOSITS: 'DEPOSITS',
    })
    // Cada agente, al terminar, pasa por log_event → track_tokens → END.
    .addEdge('SALES', 'log_event')
    .addEdge('ADMIN', 'log_event')
    .addEdge('COLLECTIONS', 'log_event')
    .addEdge('LOGISTICS', 'log_event')
    .addEdge('DEPOSITS', 'log_event')
    .addEdge('log_event', 'track_tokens')
    .addEdge('track_tokens', END)
    .compile();
}
