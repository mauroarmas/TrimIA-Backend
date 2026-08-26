import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { LlmService } from '../ai/llm/llm.service';
import { MaterialDePregunta } from './interviews-questions';
import { InterviewQuestionKind } from '@prisma/client';

/**
 * Las dos únicas llamadas al modelo de una sesión (spec 010, D4): redactar
 * todas las preguntas al abrir, y redactar una ficha por respuesta al
 * cerrar. Usa `llm.chat` (temp 0.7) y no `classifierChat`: redactar texto
 * natural es generación, no clasificación — mismo criterio que
 * `knowledge-ai-edit.service.ts` y `escalation-suggestion.service.ts`.
 */

// ⚠️ `.optional()` y no `.nullable()`: Gemini devuelve 400 con `.nullable()`
// (mismo hallazgo que en toda llamada estructurada del proyecto).
const preguntasSchema = z.object({
  preguntas: z
    .array(
      z.object({
        id: z
          .string()
          .describe('El id EXACTO recibido para este ítem, sin modificar'),
        texto: z
          .string()
          .describe(
            'La pregunta redactada para el responsable del área, en español, ' +
              'tono directo y concreto, sin rodeos',
          ),
        opciones: z
          .array(z.string())
          .describe(
            'Entre 2 y 3 respuestas plausibles a ESTA pregunta, redactadas como ' +
              'las diría el responsable del área. Array VACÍO si no se puede ' +
              'proponer ninguna concreta — es preferible ninguna a una genérica',
          ),
      }),
    )
    .describe('Una entrada por CADA ítem recibido, en cualquier orden'),
});

const PREGUNTAS_PROMPT =
  'Sos un asistente que ayuda a armar una entrevista corta a el/la responsable de un ' +
  'área de una empresa comercial, para capturar conocimiento que el asistente de ' +
  'atención no pudo usar.\n\n' +
  'Recibís una lista de ítems (cada uno con un id) que describen de qué se trata cada ' +
  'pregunta. Redactá UNA pregunta por ítem, en español, natural y concreta — no un ' +
  'formulario. Citá, cuando el ítem trae consultas reales, al menos una tal cual está ' +
  'escrita, para que se entienda qué se está preguntando.\n\n' +
  'Reglas:\n' +
  '- Devolvé exactamente un `texto` por CADA id recibido. No inventes ids ni omitas ' +
  'ninguno.\n' +
  '- Si el ítem trae un documento existente, la pregunta pide qué le FALTA a ese ' +
  'documento — nunca pide "escribir uno nuevo".\n' +
  '- Si el ítem trae una resolución de un caso, la pregunta pide CONFIRMAR una versión ' +
  'general de esa resolución, no repetirla.\n' +
  '- Si el ítem no trae nada propuesto, la pregunta simplemente pide la respuesta.\n\n' +
  'Además de la pregunta, proponé para cada ítem entre 2 y 3 `opciones`: respuestas ' +
  'posibles a ESA pregunta, para que quien contesta pueda elegir una en vez de escribir ' +
  'desde cero.\n\n' +
  'Reglas de las opciones:\n' +
  '- Redactalas como las diría el responsable del área: una respuesta concreta y ' +
  'completa, no un título ni una categoría.\n' +
  '- Tienen que ser CONCRETAS y DISTINTAS entre sí — que elegir una diga algo que ' +
  'elegir otra no dice.\n' +
  '- ⚠️ Prohibido lo genérico: nada de "depende del caso", "habría que consultarlo", ' +
  '"varía según el cliente" ni equivalentes. Una opción que serviría para cualquier ' +
  'pregunta no sirve para ninguna.\n' +
  '- Si el ítem no te da material para proponer nada concreto, devolvé `opciones` ' +
  'VACÍO. Preferimos ninguna opción antes que una de relleno: quien contesta siempre ' +
  'puede escribir con sus palabras, y el conocimiento útil suele ser justo el que no ' +
  'estaba en la lista.';

const fichaSchema = z.object({
  title: z
    .string()
    .describe('Título corto (3-8 palabras) del conocimiento, en español'),
  content: z
    .string()
    .describe(
      'El contenido redactado a partir de la respuesta, en español, como si fuera un ' +
        'párrafo de un documento de la base de conocimiento — no una transcripción de la ' +
        'charla',
    ),
});

const FICHA_PROMPT_BASE =
  'Sos un asistente que redacta un fragmento de la base de conocimiento de una empresa ' +
  'comercial, a partir de la respuesta que un responsable de área dio en una entrevista.\n\n' +
  'Redactá como si fuera a leerlo alguien que nunca vio la pregunta: un párrafo de ' +
  'conocimiento, no una transcripción de "pregunta: ... respuesta: ...".';

const FICHA_PROMPT_GENERALIZAR =
  FICHA_PROMPT_BASE +
  '\n\n⚠️ Este caso viene de una resolución real, escrita para un cliente concreto. ' +
  'La ficha que redactes NO debe contener el nombre del cliente, su teléfono, ni ningún ' +
  'dato de su caso puntual (número de pedido, monto, fecha específica de ESE caso). Sacá ' +
  'la regla o el dato GENERAL que hay detrás — lo que sirve para el próximo caso parecido, ' +
  'no este caso.';

@Injectable()
export class InterviewsDraftingService {
  private readonly logger = new Logger(InterviewsDraftingService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Una sola pasada para toda la sesión (FR-006a). `items` ya vienen con su
   * `kind` decidido (`elegirForma`) — este método solo redacta el texto y,
   * desde la spec 012, las opciones de respuesta de cada pregunta.
   *
   * **Las opciones no agregan una llamada**: viajan dentro de esta misma,
   * como un campo más del schema. Una sesión sigue costando 1 + N (FR-011).
   *
   * La degradación es asimétrica a propósito:
   * - Falta el **texto** de algún id → `null`, y la sesión queda FALLIDA. Sin
   *   pregunta no hay entrevista (T024/FR-005).
   * - Faltan las **opciones** → esa pregunta queda con `[]` y la sesión
   *   sigue. Una pregunta sin opciones se contesta con texto libre, que es un
   *   estado normal y no una falla (FR-006, SC-004).
   */
  async redactarPreguntas(
    items: {
      id: string;
      kind: InterviewQuestionKind;
      material: MaterialDePregunta;
    }[],
  ): Promise<Map<string, { texto: string; opciones: string[] }> | null> {
    if (items.length === 0) return new Map();

    const structured = this.llm.chat.withStructuredOutput(preguntasSchema, {
      name: 'interview_questions',
    });

    const listado = items
      .map((it) => `[${it.id}] (${it.kind}) ${this.describirItem(it.material)}`)
      .join('\n\n');

    let parsed: z.infer<typeof preguntasSchema>;
    try {
      parsed = (await structured.invoke([
        new SystemMessage(PREGUNTAS_PROMPT),
        new HumanMessage(listado),
      ])) as z.infer<typeof preguntasSchema>;
    } catch (err) {
      this.logger.error(
        `Falló la redacción de preguntas: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }

    const textos = new Map<string, { texto: string; opciones: string[] }>();
    for (const p of parsed.preguntas) {
      if (!p.texto?.trim()) continue;
      textos.set(p.id, {
        texto: p.texto.trim(),
        // `opciones` puede venir ausente o con entradas en blanco: se limpia
        // y, si no queda ninguna, la pregunta va con texto libre solo.
        opciones: (p.opciones ?? [])
          .map((o) => o?.trim())
          .filter((o): o is string => !!o),
      });
    }

    const faltantes = items.filter((it) => !textos.has(it.id));
    if (faltantes.length > 0) {
      this.logger.error(
        `La redacción de preguntas quedó incompleta: faltan ${faltantes.length} de ${items.length}`,
      );
      return null;
    }

    return textos;
  }

  private describirItem(material: MaterialDePregunta): string {
    switch (material.origin) {
      case 'TEMA_COBERTURA': {
        const citas = material.quotes.map((q) => `"${q}"`).join(', ');
        if (material.documents.length > 0) {
          return (
            `Tema: "${material.label}". Existe el documento "${material.documents[0].title}" ` +
            `pero no alcanzó. Consultas reales: ${citas}.`
          );
        }
        return `Tema: "${material.label}". No hay ningún documento sobre esto. Consultas reales: ${citas}.`;
      }
      case 'ESCALADO_SIN_CAPITALIZAR':
        return `Un caso se resolvió así: "${material.resolutionText}". Pedí confirmar una versión general de esto.`;
      case 'ESCALADO_PENDIENTE':
        return `Esta consulta quedó sin responder: "${material.quotes[0]}". Pedí la respuesta.`;
      // ⚠️ Sin este caso el `switch` caía en `undefined` y el modelo recibía
      // "[id] (CORREGIR) undefined": redactaba una pregunta de relleno
      // ("aclarame el punto que quedó incompleto") que no dice QUÉ falta ni
      // de qué documento habla. Encontrado en vivo con la spec 012, cuando el
      // historial dejó las preguntas a la vista una al lado de la otra.
      //
      // El material tiene todo lo que hace falta para preguntar bien: las
      // preguntas concretas que el documento no contesta y el motivo del
      // detector. Se le pasan las dos cosas.
      case 'DOCUMENTO_INCONCLUSO': {
        const faltantes = material.unansweredQuestions
          .map((q) => `"${q}"`)
          .join(', ');
        const base =
          `El documento "${material.document.title}" quedó incompleto. ` +
          `Motivo: ${material.reason}.`;
        return faltantes
          ? `${base} No contesta: ${faltantes}. Preguntá por ESO en concreto, ` +
              `citando lo que el documento no cubre — no pidas "aclarar el punto".`
          : `${base} Preguntá qué le falta a ese documento en concreto.`;
      }
    }
  }

  /**
   * Una llamada por respuesta útil, al cerrar (FR-024). Para `GENERALIZAR`
   * (T060), el prompt exige sacar nombre, teléfono y datos del caso puntual
   * — es la defensa de FR-013b/SC-010: lo que se ingesta nunca es la
   * resolución tal como se envió.
   */
  async redactarFicha(input: {
    kind: InterviewQuestionKind;
    preguntaTexto: string;
    respuestaCruda: string;
  }): Promise<{ title: string; content: string } | null> {
    const structured = this.llm.chat.withStructuredOutput(fichaSchema, {
      name: 'interview_ficha',
    });

    const prompt =
      input.kind === 'GENERALIZAR'
        ? FICHA_PROMPT_GENERALIZAR
        : FICHA_PROMPT_BASE;

    let parsed: z.infer<typeof fichaSchema>;
    try {
      parsed = (await structured.invoke([
        new SystemMessage(prompt),
        new HumanMessage(`Pregunta: ${input.preguntaTexto}`),
        new HumanMessage(`Respuesta: ${input.respuestaCruda}`),
      ])) as z.infer<typeof fichaSchema>;
    } catch (err) {
      this.logger.error(
        `Falló la redacción de una ficha: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }

    if (!parsed.title?.trim() || !parsed.content?.trim()) return null;

    return { title: parsed.title.trim(), content: parsed.content.trim() };
  }
}
