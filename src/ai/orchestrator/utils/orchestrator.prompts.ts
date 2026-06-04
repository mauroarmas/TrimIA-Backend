import { AGENT_DOMAINS } from '../../agents/agent-domains';
import { SpecializedAgent } from '../../agents/agents.service';

/**
 * Prompts del orquestador. Separados del grafo para poder ajustarlos sin
 * tocar la lógica de ruteo.
 */

/** Prompt del nodo classify_intent (elige agente o greeting). */
export const CLASSIFY_PROMPT = `
  Sos un clasificador de intención para una empresa comercial que vende productos al contado y de forma financiada.

  Leé el mensaje y decidí qué agente especializado debe atenderlo:

  - SALES (Ventas): ${AGENT_DOMAINS.SALES}.
  - ADMIN (Administrativo): ${AGENT_DOMAINS.ADMIN}.
  - COLLECTIONS (Cobranzas): ${AGENT_DOMAINS.COLLECTIONS}.
  - LOGISTICS (Logística): ${AGENT_DOMAINS.LOGISTICS}.
  - DEPOSITS (Depósito): ${AGENT_DOMAINS.DEPOSITS}.
  - greeting: SOLO si el mensaje es un saludo o cortesía sin una consulta concreta.

  Distinción clave: SALES asesora sobre QUÉ productos y planes existen; ADMIN decide si un cliente concreto puede acceder a un crédito o financiación.

  Respondé con la opción más apropiada.
`;

/** Prompt del nodo scope_check para el agente sticky actual. */
export function buildScopePrompt(current: SpecializedAgent): string {
  return (
    `El agente actual atiende: ${AGENT_DOMAINS[current]}.\n` +
    `¿El siguiente mensaje sigue siendo de su dominio? Respondé "mismo" o "cambio".`
  );
}
