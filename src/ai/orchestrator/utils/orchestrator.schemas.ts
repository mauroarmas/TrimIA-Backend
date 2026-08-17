import { z } from 'zod';
import { SpecializedAgent } from '../../agents/agents.service';

/**
 * Esquemas de salida estructurada para los nodos del orquestador.
 * `withStructuredOutput` obliga a Gemini a responder exactamente con estos
 * valores — no hay que parsear texto libre.
 */

/**
 * Schema de classify_intent acotado a los agentes permitidos para el usuario.
 * El modelo solo puede elegir entre esos agentes (+ greeting).
 */
export function buildClassificationSchema(allowed: SpecializedAgent[]) {
  return z.object({
    intent: z
      .enum([...allowed, 'greeting'] as unknown as [string, ...string[]])
      .describe(
        'El agente que debe atender el mensaje, o greeting si es un saludo',
      ),
    greetingType: z
      .enum(['apertura', 'cierre'])
      .optional()
      .describe(
        'SOLO si intent es "greeting": "apertura" si es un saludo inicial ' +
          '(hola, buenas), "cierre" si es un agradecimiento o despedida ' +
          '(gracias, dale, genial). Omitir en cualquier otro caso.',
      ),
  });
}

/**
 * Resultado de scope_check: si el mensaje sigue en el dominio del agente.
 * Acotado a los agentes permitidos para el usuario, igual que classify_intent.
 */
export function buildScopeSchema(allowed: SpecializedAgent[]) {
  return z.object({
    decision: z
      .enum(['mismo', 'cambio'])
      .describe(
        'mismo = sigue en el dominio del agente actual; cambio = es otro tema',
      ),
    isGreeting: z
      .boolean()
      .describe(
        'true si el mensaje es principalmente un saludo/cortesía sin una consulta concreta',
      ),
    greetingType: z
      .enum(['apertura', 'cierre'])
      .optional()
      .describe(
        'SOLO si isGreeting es true: "apertura" si es un saludo inicial, ' +
          '"cierre" si es un agradecimiento o despedida. Omitir si isGreeting es false.',
      ),
    targetAgent: z
      .enum([...allowed] as unknown as [string, ...string[]])
      .optional()
      .describe(
        'SOLO si decision es "cambio" y NO es un saludo: a cuál de los ' +
          'otros agentes corresponde el mensaje. Ahorra una segunda ' +
          'clasificación. Omitir en cualquier otro caso.',
      ),
  });
}
