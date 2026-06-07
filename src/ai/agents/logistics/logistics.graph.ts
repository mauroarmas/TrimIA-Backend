import {
  AgentGraphDeps,
  buildRagAgentGraph,
} from '../shared/rag-agent.graph';
import { LOGISTICS_PROMPT } from './logistics.prompt';

/**
 * Agente de LOGÍSTICA (Fase 4 Inc. 2) — flujo RAG capacitativo.
 *
 * Solo accesible para EMPLEADO. Resuelve consultas internas sobre envíos,
 * tiempos de entrega y despacho de mercadería. Sin herramientas externas:
 * todo el conocimiento viene del corpus (RAG-only).
 */
export function buildLogisticsGraph(deps: AgentGraphDeps) {
  return buildRagAgentGraph(
    {
      agentType: 'LOGISTICS',
      prompt: LOGISTICS_PROMPT,
      escalationMessage:
        'No tengo esa información en la base de conocimiento. Te sugiero consultar con el área de logística. 🚚',
    },
    deps,
  );
}
