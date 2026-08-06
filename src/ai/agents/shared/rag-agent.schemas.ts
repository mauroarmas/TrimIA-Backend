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
    .describe('Motivo de la derivación, en una línea. Solo si needsHuman es true'),
  internalNote: z
    .string()
    .optional()
    .describe(
      'Resumen del caso para el supervisor que lo tome. Nunca lo ve el cliente. Solo si needsHuman es true',
    ),
});

/**
 * Instrucciones sobre los campos de arriba, anexadas al prompt de cada agente.
 *
 * Viven acá y no en los 5 archivos `*.prompt.ts` porque son una regla del
 * mecanismo de derivación, no de la personalidad de cada agente.
 *
 * El énfasis en NO sobre-derivar es deliberado: `needsHuman: true` deja la
 * conversación en WAITING_HUMAN, y mientras tanto el MessageProcessor no
 * vuelve a invocar al agente — el cliente queda sin respuesta automática
 * hasta que una persona conteste desde el panel.
 */
export const HANDOFF_INSTRUCTIONS = `
Además del mensaje para el cliente, completá estos campos:

- needsHuman: true SOLO si el caso necesita que intervenga una persona y no
  podés avanzar vos. Por ejemplo: el cliente pide expresamente hablar con
  alguien; en tu respuesta le prometés consultarlo o derivarlo; o hace falta
  una decisión que no te corresponde (aprobar un crédito, confirmar stock
  real, autorizar una excepción, cerrar una venta).
  Poné false si podés seguir atendiendo vos: consultas que el contexto ya
  responde, preguntas generales, o cuando solo estás pidiéndole más datos al
  cliente para continuar.
  Sé coherente con lo que escribís: si en tu respuesta decís que vas a
  consultarlo con alguien, needsHuman TIENE que ser true.
  IMPORTANTE: needsHuman=true pausa la conversación hasta que responda una
  persona. No lo actives "por las dudas".

- handoffReason: si needsHuman es true, el motivo en una línea.

- internalNote: si needsHuman es true, un resumen para el supervisor que tome
  el caso, para que no tenga que leer toda la conversación. Incluí qué pidió
  el cliente, qué datos ya dio, qué quedó pendiente y qué le prometiste.
  Este texto NO se le envía al cliente.
`;