import { AgentGraphDeps, buildRagAgentGraph } from '../shared/rag-agent.graph';
import { COLLECTIONS_PROMPT } from './collections.prompt';

/**
 * Agente de COBRANZAS (Fase 4 Inc. 2) — flujo RAG sobre la fábrica común.
 *
 * Maneja cuotas, vencimientos, deudas y avisos de pago (rol "cobrador online"
 * de Credimisión). La confirmación de pago la valida un humano: el agente solo
 * recibe el aviso/comprobante y deriva (ver flujo de confirmación de pago).
 */
export function buildCollectionsGraph(deps: AgentGraphDeps) {
  return buildRagAgentGraph(
    {
      agentType: 'COLLECTIONS',
      prompt: COLLECTIONS_PROMPT,
      escalationMessage:
        'Dejame verificarlo con el área de cobranzas y te confirmo a la brevedad. 🙌',
    },
    deps,
  );
}
