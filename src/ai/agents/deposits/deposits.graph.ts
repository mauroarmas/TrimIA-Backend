import { AgentGraphDeps, buildRagAgentGraph } from '../shared/rag-agent.graph';
import { DEPOSITS_PROMPT } from './deposits.prompt';

/**
 * Agente de DEPÓSITO (Fase 4 Inc. 2) — flujo RAG capacitativo.
 *
 * Solo accesible para EMPLEADO. Resuelve consultas internas sobre stock,
 * disponibilidad y fotos/videos de productos. Sin herramientas externas:
 * todo el conocimiento viene del corpus (RAG-only).
 */
export function buildDepositsGraph(deps: AgentGraphDeps) {
  return buildRagAgentGraph(
    {
      agentType: 'DEPOSITS',
      prompt: DEPOSITS_PROMPT,
      escalationMessage:
        'Eso no lo tengo a mano. Consultalo directamente con el encargado de depósito. 📦',
    },
    deps,
  );
}
