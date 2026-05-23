import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';

/**
 * Agente de LOGÍSTICA (stub).
 *
 *   [START] → generate_response → [END]
 *
 * En Fase 4 manejará envíos, tiempos de entrega y despacho de mercadería.
 */
export function buildLogisticsGraph(logger: Logger) {
  const generateResponse = async (_state: OrchestratorStateType) => {
    logger.log('[LOGISTICS] generando respuesta (stub)');
    return {
      response: 'Hola, soy el agente de Logística.',
    };
  };

  return new StateGraph(OrchestratorState)
    .addNode('generate_response', generateResponse)
    .addEdge(START, 'generate_response')
    .addEdge('generate_response', END)
    .compile();
}
