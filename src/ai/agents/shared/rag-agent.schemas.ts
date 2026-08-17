import { z } from 'zod';

/**
 * Salida estructurada de `generate_response` (Sprint 3 extendido).
 *
 * Antes el nodo devolvía texto libre, así que cuando el agente escribía "te
 * derivo con un responsable" no pasaba absolutamente nada: ninguna Escalation,
 * nada en el panel del supervisor. El agente prometía algo que no podía
 * cumplir. Ahora la decisión de derivar viaja como un campo aparte del texto,
 * y el grafo la puede accionar.
 *
 * Sale de la MISMA llamada a Gemini que la respuesta — no agrega costo ni
 * latencia, igual que `isGreeting` en scope_check.
 *
 * Las instrucciones sobre cuándo completar cada campo están en
 * `rag-agent.instructions.ts`.
 *
 * ⚠️ Los campos opcionales usan `.optional()` y NO `.nullable()`: Gemini
 * devuelve 400 Bad Request con `.nullable()` (ya nos pasó con el schema de
 * extracción de comprobantes en Sprint 4 — ver docs/sprint-4-summary/).
 */
export const agentResponseSchema = z.object({
  response: z
    .string()
    .describe('El mensaje que se le envía al cliente por WhatsApp'),
  needsHuman: z
    .boolean()
    .describe(
      'true si el caso necesita que intervenga una persona y el agente no puede avanzar solo',
    ),
  handoffReason: z
    .string()
    .optional()
    .describe(
      'Motivo de la derivación, en una línea. Solo si needsHuman es true',
    ),
  internalNote: z
    .string()
    .optional()
    .describe(
      'Resumen del caso para el supervisor que lo tome. Nunca lo ve el cliente. Solo si needsHuman es true',
    ),
});
