import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { Audience } from '@prisma/client';
import { LlmService } from '../../llm/llm.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';
import { SpecializedAgent } from '../agents.service';

/** Dependencias de infraestructura comunes a todo agente RAG. */
export interface AgentGraphDeps {
  llm: LlmService;
  knowledge: KnowledgeService;
  confidenceThreshold: number;
  logger: Logger;
}

/** Configuración específica de cada agente RAG. */
export interface RagAgentConfig {
  /** Para filtrar el corpus y etiquetar logs. */
  agentType: SpecializedAgent;
  /** SystemMessage con la "personalidad" e instrucciones del agente. */
  prompt: string;
  /** Mensaje al usuario cuando la confianza es baja y se deriva a un humano. */
  escalationMessage?: string;
}

const DEFAULT_ESCALATION =
  'Dejame consultarlo con un responsable y te respondo a la brevedad. 🙌';

/**
 * Fábrica genérica del flujo RAG de un agente especializado:
 *
 *   [START] → retrieve_context → (evaluate_confidence)
 *                 ├─ confianza ok  → generate_response → [END]
 *                 └─ confianza baja → escalate_to_human → [END]
 *
 * Comparte el OrchestratorState, así cada agente se enchufa como subgrafo
 * del grafo principal. SALES, COBRANZAS y ADMIN se construyen con esta fábrica;
 * solo cambian su `agentType` (filtro del corpus) y su `prompt`.
 */
export function buildRagAgentGraph(
  config: RagAgentConfig,
  deps: AgentGraphDeps,
) {
  const { agentType, prompt, escalationMessage = DEFAULT_ESCALATION } = config;
  const { llm, knowledge, confidenceThreshold, logger } = deps;
  const tag = `[${agentType}]`;

  // --- NODO: retrieve_context — busca en la base de conocimiento ---
  const retrieveContext = async (state: OrchestratorStateType) => {
    // La audiencia depende de quién pregunta: el empleado ve lo interno; el cliente, solo lo público.
    const audience =
      state.userType === 'EMPLEADO' ? Audience.INTERNO : Audience.PUBLICO;

    const hits = await knowledge.search(state.message, {
      audience,
      agentType,
      k: 4,
    });
    const confidence = hits[0]?.score ?? 0;
    const context = hits.map((h) => `- ${h.content}`).join('\n');

    logger.log(
      `${tag} retrieve: ${hits.length} chunks, confianza=${confidence.toFixed(2)}`,
    );
    return { context, confidence };
  };

  // --- NODO: generate_response — Gemini responde con el contexto recuperado ---
  const generateResponse = async (state: OrchestratorStateType) => {
    // Historial de turnos previos inyectado como mensajes de chat.
    // Permite que el agente resuelva referencias como "¿y esa en cuotas?".
    const historyMessages: BaseMessage[] = (state.history ?? []).map((turn) =>
      turn.role === 'USER'
        ? new HumanMessage(turn.content)
        : new AIMessage(turn.content),
    );

    const result = await llm.chat.invoke([
      new SystemMessage(prompt),
      ...historyMessages,
      new HumanMessage(
        `Contexto de la base de conocimiento:\n${state.context || '(sin resultados)'}\n\n` +
          `Consulta del usuario: ${state.message}`,
      ),
    ]);
    const usage = (result as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    const response =
      typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);

    logger.log(`${tag} respuesta generada con RAG`);
    return {
      response,
      // Acumula los tokens de la generación sobre los del orquestador (clasificación/scope).
      inputTokens: (state.inputTokens ?? 0) + (usage?.input_tokens ?? 0),
      outputTokens: (state.outputTokens ?? 0) + (usage?.output_tokens ?? 0),
    };
  };

  // --- NODO: escalate_to_human — confianza baja, deriva a un responsable ---
  const escalateToHuman = async (state: OrchestratorStateType) => {
    logger.log(
      `${tag} confianza baja (${(state.confidence ?? 0).toFixed(2)}) → escalar a humano`,
    );
    return {
      response: escalationMessage,
      escalated: true,
    };
  };

  // --- ROUTER: evaluate_confidence (sin LLM) ---
  const evaluateConfidence = (state: OrchestratorStateType): string =>
    (state.confidence ?? 0) >= confidenceThreshold ? 'generate' : 'escalate';

  return new StateGraph(OrchestratorState)
    .addNode('retrieve_context', retrieveContext)
    .addNode('generate_response', generateResponse)
    .addNode('escalate_to_human', escalateToHuman)
    .addEdge(START, 'retrieve_context')
    .addConditionalEdges('retrieve_context', evaluateConfidence, {
      generate: 'generate_response',
      escalate: 'escalate_to_human',
    })
    .addEdge('generate_response', END)
    .addEdge('escalate_to_human', END)
    .compile();
}
