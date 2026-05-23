import { Logger } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  OrchestratorState,
  OrchestratorStateType,
} from '../../orchestrator/orchestrator.state';

/**
 * Agente de VENTAS (stub).
 *
 * Subgrafo con un solo nodo que responde texto fijo:
 *   [START] → generate_response → [END]
 *
 * Usa el mismo State que el orquestador, así en el paso 3.4 se enchufa como un
 * nodo del grafo principal sin traducir datos entre estados distintos.
 *
 * En Fase 4 el nodo generate_response se reemplaza por el flujo real:
 *   retrieve_context → evaluate_confidence → generate_response / escalate_to_human
 */
export function buildSalesGraph(logger: Logger) {
  const generateResponse = async (_state: OrchestratorStateType) => {
    logger.log('[SALES] generando respuesta (stub)');
    return {
      response: 'Hola, soy el agente de Ventas. ¿En qué puedo ayudarte?',
    };
  };

  return new StateGraph(OrchestratorState)
    .addNode('generate_response', generateResponse)
    .addEdge(START, 'generate_response')
    .addEdge('generate_response', END)
    .compile();
}
