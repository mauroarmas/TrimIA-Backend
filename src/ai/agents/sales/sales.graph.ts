import { AgentGraphDeps, buildRagAgentGraph } from '../shared/rag-agent.graph';
import { SALES_PROMPT } from './sales.prompt';
import { createCheckStockTool } from '../../integrations/tools/check-stock.tool';
import { createSaveProspectTool } from '../../integrations/tools/save-prospect.tool';

/**
 * Agente de VENTAS (Fase 4 Inc. 2 + Sprint 6) — flujo RAG con tools de stock y CRM.
 * Ver `shared/rag-agent.graph.ts` para el detalle del subgrafo.
 */
export function buildSalesGraph(deps: AgentGraphDeps) {
  const tools: any[] = [];
  if (deps.stockPort) {
    tools.push(createCheckStockTool(deps.stockPort));
  }
  if (deps.crmPort) {
    tools.push(createSaveProspectTool(deps.crmPort));
  }
  return buildRagAgentGraph({ agentType: 'SALES', prompt: SALES_PROMPT, tools }, deps);
}

export type { AgentGraphDeps };
