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
      .describe('El agente que debe atender el mensaje, o greeting si es un saludo'),
  });
}

/** Resultado de scope_check: si el mensaje sigue en el dominio del agente. */
export const scopeSchema = z.object({
  decision: z
    .enum(['mismo', 'cambio'])
    .describe('mismo = sigue en el dominio del agente actual; cambio = es otro tema'),
  isGreeting: z
    .boolean()
    .describe('true si el mensaje es principalmente un saludo/cortesía sin una consulta concreta'),
});
