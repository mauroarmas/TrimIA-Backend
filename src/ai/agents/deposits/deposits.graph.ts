import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';

/**
 * Agente de DEPÓSITO (stub).
 *
 *   [START] → generate_response → [END]
 *
 * En Fase 4 manejará consultas de stock, disponibilidad y fotos/videos de productos.
 */
export function buildDepositsGraph(logger: Logger) {
  const generateResponse = async (_state: OrchestratorStateType) => {
    logger.log('[DEPOSITS] generando respuesta (stub)');
    return {
      response: 'Hola, soy el agente de Depósito.',
    };
  };

  return new StateGraph(OrchestratorState)
    .addNode('generate_response', generateResponse)
    .addEdge(START, 'generate_response')
    .addEdge('generate_response', END)
    .compile();
}
