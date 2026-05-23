import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';

/**
 * Agente ADMINISTRATIVO (stub).
 *
 *   [START] → generate_response → [END]
 *
 * Maneja el proceso crítico de otorgamiento de crédito y aprobación de
 * financiación. En Fase 5 será el ÚNICO agente con acceso a Riesgo Online
 * (verificación crediticia, gate de financiación, control documental).
 * Es el agente más auditable del sistema en Paperclip.
 */
export function buildAdminGraph(logger: Logger) {
  const generateResponse = async (_state: OrchestratorStateType) => {
    logger.log('[ADMIN] generando respuesta (stub)');
    return {
      response: 'Hola, soy el agente Administrativo.',
    };
  };

  return new StateGraph(OrchestratorState)
    .addNode('generate_response', generateResponse)
    .addEdge(START, 'generate_response')
    .addEdge('generate_response', END)
    .compile();
}
