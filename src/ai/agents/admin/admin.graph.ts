import { AgentGraphDeps, buildRagAgentGraph } from '../shared/rag-agent.graph';
import { ADMIN_PROMPT } from './admin.prompt';
import { createEvaluateCreditTool } from '../../integrations/tools/evaluate-credit.tool';

/**
 * Agente ADMINISTRATIVO (Fase 4 Inc. 2 + Sprint 6) — flujo RAG con tool de crédito confidencial.
 */
export function buildAdminGraph(deps: AgentGraphDeps) {
  const tools: any[] = [];
  if (deps.administrativeCredit || deps.creditPort) {
    tools.push(
      createEvaluateCreditTool(deps.administrativeCredit ?? deps.creditPort),
    );
  }
  return buildRagAgentGraph(
    {
      agentType: 'ADMIN',
      prompt: ADMIN_PROMPT,
      tools,
      escalationMessage:
        'Voy a derivar esta consulta a un responsable para su validación. Queda registrada para seguimiento. 🙌',
    },
    deps,
  );
}
