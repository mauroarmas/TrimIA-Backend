import { z } from 'zod';

/**
 * El detector de documentos inconclusos: esquema y prompt.
 *
 * Puro a propósito — sin Nest ni Prisma — porque acá vive la calibración que
 * la Fase 0 tuvo que corregir, y probarla no debe requerir levantar nada.
 *
 * ## Por qué severidad y no confianza
 *
 * La spec apostaba a preguntar "¿está inconcluso?" con una confianza de tres
 * niveles y quedarse con los de confianza alta. Medido sobre los 75 documentos
 * reales: el modelo señaló 53 (71% del corpus) y devolvió `ALTA` en los 53,
 * `MEDIA` y `BAJA` en ninguno. El filtro no cortaba nada.
 *
 * La causa no es el modelo, es la pregunta: casi todo documento *está*
 * incompleto en algún sentido, así que un sí/no obtiene un sí honesto y sin
 * valor. Lo que hace falta no es cuán seguro está el modelo sino **cuánto
 * duele la carencia** — y eso sí discrimina (12% por encima de 80).
 */

// ⚠️ `.optional()` y no `.nullable()`: Gemini devuelve 400 con `.nullable()`.
export const senalamientoSchema = z.object({
  severity: z
    .number()
    .min(0)
    .max(100)
    .describe(
      'Cuánto DUELE lo que le falta a este documento, de 0 a 100. No es ' +
        'cuánta confianza tenés en tu juicio.',
    ),
  reason: z
    .string()
    .describe(
      'En una frase, qué le falta o qué queda ambiguo. Concreto: qué tema ' +
        'promete y no cubre, o qué contradicción tiene adentro.',
    ),
  unansweredQuestions: z
    .array(z.string())
    .min(1)
    .describe(
      'Las preguntas concretas que alguien con una necesidad real le haría ' +
        'a este documento y que el documento NO responde. Al menos una.',
    ),
});

export type Senalamiento = z.infer<typeof senalamientoSchema>;

/**
 * La barra de calibración es lo que hizo que la severidad discriminara (D2).
 * Sin ella la pregunta vuelve a ser un sí/no disfrazado de número: el modelo
 * pone 80 a todo lo que le parece mejorable, que es todo.
 */
export const DETECTOR_PROMPT =
  'Sos un revisor del material de consulta de una empresa comercial. Recibís UN ' +
  'documento y decidís cuánto le falta para bastarse a sí mismo.\n\n' +
  'La pregunta NO es "¿se puede mejorar?" — todo documento se puede mejorar. La ' +
  'pregunta es: si alguien viene con una necesidad real sobre este tema y lee solo ' +
  'esto, ¿se queda sin respuesta en algo importante?\n\n' +
  'Calibrá la severidad así:\n' +
  '- **80-100**: el documento se contradice, o el título promete algo que el cuerpo ' +
  'no cubre, o falta el caso central del tema que dice tratar. Reservá esta banda ' +
  'para eso: es poco frecuente.\n' +
  '- **60-79**: cubre su tema pero deja afuera una situación previsible y común.\n' +
  '- **30-59**: se entiende y alcanza; lo que falta es detalle o un borde raro.\n' +
  '- **0-29**: se basta a sí mismo para lo que dice cubrir.\n\n' +
  'La mayoría de los documentos razonables caen por debajo de 60. Un documento corto ' +
  'que cubre bien su tema NO es incompleto: no lo castigues por ser breve.\n\n' +
  'En `unansweredQuestions` poné las preguntas tal como las haría una persona, no ' +
  'como títulos de sección. Si no se te ocurre ninguna pregunta concreta sin ' +
  'responder, entonces la severidad es baja.';

/** El documento tal como se le muestra al modelo. */
export function armarEntradaDocumento(doc: {
  title: string;
  category?: string | null;
  content: string;
}): string {
  const categoria = doc.category ? `\nCategoría: ${doc.category}` : '';
  return `Título: ${doc.title}${categoria}\n\nContenido:\n${doc.content}`;
}
