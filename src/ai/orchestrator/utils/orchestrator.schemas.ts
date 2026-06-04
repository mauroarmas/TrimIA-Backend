import { z } from 'zod';

/**
 * Esquemas de salida estructurada para los nodos del orquestador.
 * `withStructuredOutput` obliga a Gemini a responder exactamente con estos
 * valores — no hay que parsear texto libre.
 */

/** Resultado de classify_intent: un agente o `greeting`. */
export const classificationSchema = z.object({
  intent: z
    .enum(['SALES', 'ADMIN', 'COLLECTIONS', 'LOGISTICS', 'DEPOSITS', 'greeting'])
    .describe('El agente que debe atender el mensaje, o greeting si es un saludo'),
});

/** Resultado de scope_check: si el mensaje sigue en el dominio del agente. */
export const scopeSchema = z.object({
  decision: z
    .enum(['mismo', 'cambio'])
    .describe('mismo = sigue en el dominio del agente actual; cambio = es otro tema'),
});
