import { Annotation } from '@langchain/langgraph';
import { AgentType, UserType } from '@prisma/client';
import { ConversationTurn } from '../../conversations/conversations.service';

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
  conversationId: Annotation<string | null>, // FK de la conversación: vincula eventos/tokens y, en Fase 5, será el thread_id de LangGraph
  currentAgent: Annotation<AgentType | null>, // agente sticky de la conversación (entrada)
  userType: Annotation<UserType | null>, // CLIENTE/EMPLEADO → define la audiencia del RAG
  history: Annotation<ConversationTurn[]>, // turnos previos USER/ASSISTANT (memoria conversacional)

  // --- Salidas (las van completando los nodos; arrancan en null) ---
  agentType: Annotation<AgentType | null>, // agente resuelto para este turno
  response: Annotation<string | null>, // lo completa el agente

  // --- Flujo RAG del agente ---
  context: Annotation<string | null>, // chunks recuperados por retrieve_context
  confidence: Annotation<number | null>, // score del mejor chunk (0-1)
  escalated: Annotation<boolean | null>, // true si se derivó a humano (por baja confianza O a pedido del agente)

  // --- Derivación decidida por el propio agente (no por el score del RAG) ---
  // Las completa generate_response con su salida estructurada. Cubren el caso
  // que el umbral de confianza no detecta: el RAG encontró contexto suficiente,
  // pero igual hace falta una persona (el cliente lo pide, o el agente prometió
  // consultarlo). Ver rag-agent.schemas.ts.
  needsHuman: Annotation<boolean | null>,
  handoffReason: Annotation<string | null>, // motivo, para el campo `reason` de la Escalation
  internalNote: Annotation<string | null>, // resumen del caso para el supervisor

  // --- Control del ruteo sticky ---
  scopeChanged: Annotation<boolean | null>, // lo setea scope_check (mismo/cambio)
  isGreeting: Annotation<boolean | null>, // lo setea classify_intent y scope_check
  // apertura/cierre, solo si isGreeting/intent=greeting; lo completan classify_intent
  // y scope_check en la misma llamada estructurada (sin costo extra de tokens).
  // Lo usa greeting_response para no contestar "¡Hola!" a un "gracias, genial".
  greetingType: Annotation<'apertura' | 'cierre' | null>,
  isTrivial: Annotation<boolean | null>, // lo setea trivial_response (regex)

  // --- Métricas (las llenan classify_intent y track_tokens) ---
  startedAt: Annotation<number | null>, // timestamp de inicio para calcular durationMs
  inputTokens: Annotation<number | null>, // tokens del prompt enviados a Gemini
  outputTokens: Annotation<number | null>, // tokens de la respuesta de Gemini
});

// Tipo TypeScript del state, derivado automáticamente de la definición de arriba
export type OrchestratorStateType = typeof OrchestratorState.State;
