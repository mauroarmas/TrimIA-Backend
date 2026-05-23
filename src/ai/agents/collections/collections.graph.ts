import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';

/**
 * Agente de COBRANZAS (stub).
 *
 *   [START] → generate_response → [END]
 *
 * En Fase 4 manejará el cobro de cuotas, vencimientos y comprobantes de pago
 * (rol "cobrador online" de Credimisión).
 */
export function buildCollectionsGraph(logger: Logger) {
  const generateResponse = async (_state: OrchestratorStateType) => {
    logger.log('[COLLECTIONS] generando respuesta (stub)');
    return {
      response: 'Hola, soy el agente de Cobranzas.',
    };
  };

  return new StateGraph(OrchestratorState)
    .addNode('generate_response', generateResponse)
    .addEdge(START, 'generate_response')
    .addEdge('generate_response', END)
    .compile();
}
