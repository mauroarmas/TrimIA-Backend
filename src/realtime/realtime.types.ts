import { AgentType, ConvStatus } from '@prisma/client';

/**
 * Contrato de los eventos que viajan por el bus y salen por los streams del
 * panel (spec 004). Es compartido entre quien publica (ConversationsService) y
 * quien sirve el stream (los controllers), así que vive acá y no en ninguno de
 * los dos.
 *
 * Ver specs/004-chat-tiempo-real/contracts/sse-events.md.
 */

/** Canal de Redis por conversación. Un canal por conversación, no uno global. */
export const conversationChannel = (conversationId: string): string =>
  `trimia:conversation:${conversationId}`;

/**
 * Roles que se emiten. **Solo estos dos**, igual que `listMessages()`: emitir
 * TOOL o SYSTEM mostraría por el stream mensajes que el historial no devuelve,
 * lo que además de ser una fuga (RF-015) sería inconsistente — al recargar la
 * página desaparecerían.
 */
export type RealtimeMessageRole = 'USER' | 'ASSISTANT';

export interface RealtimeMessageData {
  id: string;
  role: RealtimeMessageRole;
  content: string;
  agentType: AgentType | null;
  /** ISO 8601. Es la posición de orden: el cliente ordena por esto. */
  createdAt: string;
}

/**
 * Cambio de estado de la conversación. **No lleva `handledById`**: al dueño del
 * chat le corresponde saber que una persona lo atiende, no cuál (RF-015).
 */
export interface RealtimeStatusData {
  status: ConvStatus;
  currentAgent: AgentType | null;
}

export type RealtimeEvent =
  | { type: 'message'; conversationId: string; data: RealtimeMessageData }
  | { type: 'status'; conversationId: string; data: RealtimeStatusData };
