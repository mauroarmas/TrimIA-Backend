import { AGENT_DOMAINS, ALL_AGENTS } from '../../agents/agent-domains';
import { SpecializedAgent } from '../../agents/agents.service';

/**
 * Prompts del orquestador. Separados del grafo para poder ajustarlos sin
 * tocar la lógica de ruteo.
 */

/**
 * Prompt del nodo classify_intent. Solo ofrece los agentes permitidos para el
 * tipo de usuario (un cliente externo no puede ser derivado a Depósito/Logística/Admin).
 */
export function buildClassifyPrompt(allowed: SpecializedAgent[]): string {
  const opciones = allowed
    .map((a) => `  - ${a}: ${AGENT_DOMAINS[a]}.`)
    .join('\n');
  return `
  Sos un clasificador de intención para una empresa comercial que vende productos al contado y de forma financiada.

  Leé el mensaje y decidí cuál de estas opciones debe atenderlo:

${opciones}
  - greeting: SOLO si el mensaje es un saludo o cortesía sin una consulta concreta.

  Distinción clave: SALES asesora sobre QUÉ productos y planes existen y responde disponibilidad/stock; ADMIN (si está disponible) decide si un cliente concreto puede acceder a un crédito.
  Si la consulta no encaja claramente en ninguna, elegí SALES.

  Respondé con la opción más apropiada.
`;
}

/**
 * Prompt del nodo scope_check. Decide si el mensaje sigue en el dominio del
 * agente actual o cambió de tema. Le damos contraste (otras áreas) y una regla
 * decisiva para que no se quede "pegado" al agente por inercia.
 */
export function buildScopePrompt(current: SpecializedAgent): string {
  const otras = ALL_AGENTS.filter((a) => a !== current)
    .map((a) => `${a} (${AGENT_DOMAINS[a]})`)
    .join('; ');

  return `
El agente ACTUAL atiende: ${AGENT_DOMAINS[current]}.

Otras áreas (NO son de este agente): ${otras}.

Decidí si el siguiente mensaje del usuario sigue correspondiendo al agente ACTUAL:
- "mismo": SOLO si encaja claramente en el dominio del agente actual.
- "cambio": si corresponde mejor a otra área, o es ambiguo / no relacionado.

Ejemplo: si el agente actual es de stock/depósito y el usuario dice "quiero comprar" o pregunta precios, eso es Ventas → "cambio".
Ante la duda, respondé "cambio".

Además, marcá isGreeting: true SOLO si el mensaje es principalmente un saludo o
cortesía (ej. "gracias!", "buenísimo", "dale, saludos") sin una consulta
concreta — aunque mencione de pasada algo del dominio del agente actual. Si
hay una consulta real (aunque venga acompañada de un agradecimiento), marcá
isGreeting: false.
`;
}
