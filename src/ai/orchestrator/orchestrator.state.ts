import { Annotation } from '@langchain/langgraph';
import { AgentType, UserType } from '@prisma/client';
import { ConversationTurn } from '../../conversations/conversations.service';
import { Caller } from '../caller/caller.types';

/**
 * Un candidato que el RAG devolvió en el turno (Sprint 5A, US7).
 *
 * `rank` se guarda además del score porque responde otra pregunta: el score
 * dice cuán parecido era, el rank dice si llegó a competir. Un documento que
 * siempre sale cuarto nunca influye en la respuesta aunque tenga buen score.
 */
export interface RetrievedDoc {
  documentId: string;
  /** 0-100, como lo guarda `KnowledgeRetrieval.score` (no el 0-1 del hit). */
  score: number;
  /** Posición en el top-k; 0 es el mejor. */
  rank: number;
  /**
   * Título del documento (spec 005).
   *
   * Hace falta para que el aviso de baja confianza a un responsable pueda decir
   * QUÉ se consultó: "documento a3f2b8c1" no le sirve a nadie. El dato ya venía en
   * el `SearchHit` y hasta ahora se descartaba al mapear.
   *
   * Solo en memoria: `KnowledgeRetrieval` sigue guardando id, score y rank.
   */
  title: string;
}

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
  // Quién habla (spec 005): rol y áreas de las que es responsable. Lo consumen el
  // prompt (para el trato) y el router de confianza (para no escalarle a quien es
  // el destino del escalado).
  //
  // ⚠️ NO se usa para filtrar la recuperación. `userType` sigue siendo lo único que
  // decide audiencia y agentes permitidos — Principio I, punto único.
  caller: Annotation<Caller | null>,

  // --- Salidas (las van completando los nodos; arrancan en null) ---
  agentType: Annotation<AgentType | null>, // agente resuelto para este turno
  response: Annotation<string | null>, // lo completa el agente

  // --- Flujo RAG del agente ---
  context: Annotation<string | null>, // chunks recuperados por retrieve_context
  confidence: Annotation<number | null>, // score del mejor chunk (0-1)
  /**
   * TODOS los candidatos que devolvió el RAG este turno, no solo el que ganó
   * (Sprint 5A, US7, FR-046).
   *
   * Viaja por el estado y NO se escribe en `retrieve_context` porque el dato
   * que le da sentido —si el turno terminó respondiendo o escalando— todavía
   * no existe cuando el nodo corre: lo deciden `evaluate_confidence` y
   * `evaluate_handoff` después. Persistirlo acá obligaría a un UPDATE
   * posterior; acumularlo y escribirlo una vez al final es una sola query
   * fuera del camino que el usuario espera (research §9).
   */
  retrievedDocs: Annotation<RetrievedDoc[] | null>,
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
