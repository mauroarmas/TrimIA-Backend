import { Annotation } from '@langchain/langgraph';
import { AgentType } from '@prisma/client';

/**
 * El State es el objeto que viaja por todo el grafo.
 * Cada nodo lo lee y devuelve una parte actualizada.
 *
 * Annotation.Root define los "campos" de ese objeto. Por defecto,
 * cada campo guarda el último valor que un nodo le asigne.
 */
export const OrchestratorState = Annotation.Root({
  // --- Entradas (las pone el MessageProcessor al invocar el grafo) ---
  message: Annotation<string>,
  threadId: Annotation<string>,
  conversationId: Annotation<string | null>, // FK de negocio para vincular eventos/tokens

  // --- Salidas (las van completando los nodos; arrancan en null) ---
  agentType: Annotation<AgentType | null>, // lo decide classify_intent
  response: Annotation<string | null>, // lo completa el agente

  // --- Métricas (las llenan classify_intent y track_tokens) ---
  startedAt: Annotation<number | null>, // timestamp de inicio para calcular durationMs
  inputTokens: Annotation<number | null>, // tokens del prompt enviados a Gemini
  outputTokens: Annotation<number | null>, // tokens de la respuesta de Gemini
});

// Tipo TypeScript del state, derivado automáticamente de la definición de arriba
export type OrchestratorStateType = typeof OrchestratorState.State;
