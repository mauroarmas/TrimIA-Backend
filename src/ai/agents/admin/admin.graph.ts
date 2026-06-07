import {
  AgentGraphDeps,
  buildRagAgentGraph,
} from '../shared/rag-agent.graph';
import { ADMIN_PROMPT } from './admin.prompt';

/**
 * Agente ADMINISTRATIVO (Fase 4 Inc. 2) — flujo RAG sobre la fábrica común.
 *
 * Maneja el proceso crítico de verificación crediticia y aprobación de
 * financiación. En Fase 5 será el ÚNICO agente con acceso a Riesgo Online
 * (verificación crediticia, gate de financiación, control documental) y el
 * más auditable del sistema en Paperclip.
 */
export function buildAdminGraph(deps: AgentGraphDeps) {
  return buildRagAgentGraph(
    {
      agentType: 'ADMIN',
      prompt: ADMIN_PROMPT,
      escalationMessage:
        'Voy a derivar esta consulta a un responsable para su validación. Queda registrada para seguimiento. 🙌',
    },
    deps,
  );
}
