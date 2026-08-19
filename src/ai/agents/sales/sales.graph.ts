import { AgentGraphDeps, buildRagAgentGraph } from '../shared/rag-agent.graph';
import { SALES_PROMPT } from './sales.prompt';

/**
 * Agente de VENTAS (Fase 4 Inc. 2) — flujo RAG real sobre la fábrica común.
 * Ver `shared/rag-agent.graph.ts` para el detalle del subgrafo.
 */
export function buildSalesGraph(deps: AgentGraphDeps) {
  return buildRagAgentGraph({ agentType: 'SALES', prompt: SALES_PROMPT }, deps);
}

export type { AgentGraphDeps };
