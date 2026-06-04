import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { Audience } from '@prisma/client';
import { LlmService } from '../../llm/llm.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';
import { SALES_PROMPT } from './sales.prompt';

export interface AgentGraphDeps {
  llm: LlmService;
  knowledge: KnowledgeService;
  confidenceThreshold: number;
  logger: Logger;
}

/**
 * Agente de VENTAS (Fase 4 Inc. 2) — flujo RAG real:
 *   [START] → retrieve_context → (evaluate_confidence)
 *                 ├─ confianza ok  → generate_response → [END]
 *                 └─ confianza baja → escalate_to_human → [END]
 *
 * Comparte el OrchestratorState, así se enchufa como nodo del grafo principal.
 */
export function buildSalesGraph(deps: AgentGraphDeps) {
  const { llm, knowledge, confidenceThreshold, logger } = deps;

  // --- NODO: retrieve_context — busca en la base de conocimiento ---
  const retrieveContext = async (state: OrchestratorStateType) => {
    // La audiencia depende de quién pregunta: el empleado ve lo interno; el cliente, solo lo público.
    const audience =
      state.userType === 'EMPLEADO' ? Audience.INTERNO : Audience.PUBLICO;

    const hits = await knowledge.search(state.message, {
      audience,
      agentType: 'SALES',
      k: 4,
    });
    const confidence = hits[0]?.score ?? 0;
    const context = hits.map((h) => `- ${h.content}`).join('\n');

    logger.log(
      `[SALES] retrieve: ${hits.length} chunks, confianza=${confidence.toFixed(2)}`,
    );
    return { context, confidence };
  };

  // --- NODO: generate_response — Gemini responde con el contexto recuperado ---
  const generateResponse = async (state: OrchestratorStateType) => {
    const result = await llm.chat.invoke([
      new SystemMessage(SALES_PROMPT),
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

    logger.log('[SALES] respuesta generada con RAG');
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
      `[SALES] confianza baja (${(state.confidence ?? 0).toFixed(2)}) → escalar a humano`,
    );
    return {
      response:
        'Dejame consultarlo con un responsable y te respondo a la brevedad. 🙌',
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
