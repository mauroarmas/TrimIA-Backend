import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';

/**
 * El agrupador de temas (spec 009, US1, D5).
 *
 * **Un solo pase de LLM por corrida.** Agrupar por embeddings + clustering
 * costaría N llamadas de embeddings (los vectores de las consultas no están
 * persistidos) contra 1 de chat, y aun así haría falta el LLM para nombrar
 * los grupos y para el juicio de "¿esto es una pregunta real?" — dos
 * mecanismos donde alcanza uno (research.md D5).
 *
 * Usa `classifierChat` (temperature 0), no `chat`: es una tarea de
 * clasificación, no de generación — el mismo criterio que usan
 * `classify_intent`/`scope_check` en el orquestador.
 */

export interface GroupingQueryInput {
  /** `OrchestrationEvent.id` — la identidad que sostiene FR-028 entre corridas. */
  id: string;
  text: string;
}

export interface GroupingTheme {
  label: string;
  queryIds: string[];
  /**
   * D5/D4: si las consultas de este tema se sostienen solas como preguntas de
   * conocimiento. Solo importa para clasificar causa cuando el mejor score
   * cae bajo el piso de ruido (`classifyQuery`); para el resto de las bandas
   * es un valor que el llamador recibe pero no necesita.
   */
  esPreguntaDeConocimiento: boolean;
}

export interface GroupingResult {
  themes: GroupingTheme[];
  /** Ids que no formaron tema: por no agruparse con nada, o por no alcanzar `minQueriesPerTheme`. */
  sinAgrupar: string[];
}

/**
 * ⚠️ `.optional()` y no `.nullable()`: Gemini devuelve 400 con `.nullable()`
 * (mismo hallazgo que `knowledge-ai-edit.service.ts`).
 */
const groupingSchema = z.object({
  themes: z
    .array(
      z.object({
        label: z
          .string()
          .describe(
            'Nombre corto (3-6 palabras) y legible del tema, en español, sin jerga técnica ' +
              '("base de conocimiento", "RAG", "corpus")',
          ),
        queryIds: z
          .array(z.string())
          .describe(
            'Los ids EXACTOS de las consultas de entrada que pertenecen a este tema. ' +
              'Nunca un id que no esté en la lista recibida.',
          ),
        esPreguntaDeConocimiento: z
          .boolean()
          .describe(
            'true si las consultas de este tema son preguntas reales sobre el negocio o ' +
              'el corpus. false si en realidad son respuestas al agente ("si por favor", ' +
              '"dale", "sí"), charla, saludos, o pedidos que no tienen que ver con el ' +
              'negocio. Ante la duda, false.',
          ),
      }),
    )
    .describe(
      'Grupos de consultas sobre el mismo tema. Cada consulta pertenece A LO SUMO a un tema.',
    ),
});

const GROUPING_PROMPT =
  'Sos un asistente que ayuda a un supervisor de una empresa comercial a entender qué ' +
  'consultas de clientes o empleados el corpus de conocimiento no pudo contestar bien.\n\n' +
  'Recibís una lista de consultas (cada una con un id) que quedaron sin respuesta confiable ' +
  'o apenas la alcanzaron. Agrupalas por TEMA: consultas que preguntan lo mismo, aunque estén ' +
  'escritas distinto.\n\n' +
  'Reglas:\n' +
  '- Cada consulta entra en A LO SUMO un tema. Si una consulta no se parece a ninguna otra, ' +
  'no la incluyas en ningún tema — queda suelta, y eso está bien.\n' +
  '- No inventes consultas que no estén en la lista. Cada `queryIds` tiene que ser un ' +
  'subconjunto EXACTO de los ids recibidos, nunca uno inventado.\n' +
  '- Para cada tema, decidí si sus consultas son preguntas reales sobre el negocio o el ' +
  'corpus (`esPreguntaDeConocimiento: true`), o si en realidad son respuestas al agente, ' +
  'charla, saludos, o pedidos fuera del negocio (`esPreguntaDeConocimiento: false`). Ante la ' +
  'duda, false: es preferible no proponer cargar un documento sobre algo que no lo necesita.';

@Injectable()
export class KnowledgeCoverageGroupingService {
  private readonly logger = new Logger(KnowledgeCoverageGroupingService.name);

  constructor(private readonly llm: LlmService) {}

  async group(
    queries: GroupingQueryInput[],
    previousLabels: string[],
    minQueriesPerTheme: number,
  ): Promise<GroupingResult> {
    if (queries.length === 0) return { themes: [], sinAgrupar: [] };

    const structured = this.llm.classifierChat.withStructuredOutput(
      groupingSchema,
      { name: 'coverage_grouping' },
    );

    const listado = queries.map((q) => `[${q.id}] "${q.text}"`).join('\n');
    const reuso =
      previousLabels.length > 0
        ? `\n\nTemas de la corrida anterior — reusá el mismo nombre cuando el tema sea el ` +
          `mismo: ${previousLabels.join(', ')}`
        : '';

    let parsed: z.infer<typeof groupingSchema>;
    try {
      parsed = (await structured.invoke([
        new SystemMessage(GROUPING_PROMPT + reuso),
        new HumanMessage(listado),
      ])) as z.infer<typeof groupingSchema>;
    } catch (err) {
      // Degradación: TODO queda suelto, sin tema. Es preferible una corrida
      // sin temas —se informa como looseQueries— a una que muestra grupos de
      // un modelo que no respondió (Principio II).
      this.logger.error(
        `Falló el agrupamiento de cobertura: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return { themes: [], sinAgrupar: queries.map((q) => q.id) };
    }

    const validIds = new Set(queries.map((q) => q.id));
    const usedIds = new Set<string>();
    const themes: GroupingTheme[] = [];

    for (const t of parsed.themes) {
      // T016 — Principio II por construcción: un tema con AL MENOS un id que
      // no está en el lote de entrada, o que se pisa con otro tema, se
      // descarta ENTERO. No se filtran solo los ids malos: un tema que
      // alucinó parte de sus consultas no es un tema del que se pueda
      // confiar el resto.
      const idsUnicos = new Set(t.queryIds);
      const todosValidos =
        t.queryIds.length > 0 &&
        t.queryIds.length === idsUnicos.size &&
        t.queryIds.every((id) => validIds.has(id) && !usedIds.has(id));
      if (!todosValidos) {
        this.logger.warn(
          `Tema descartado por consultas inválidas o repetidas: "${t.label}"`,
        );
        continue;
      }

      // Mínimo de consultas para reportarse como tema (FR-003): por debajo,
      // sus ids quedan sueltos, pero SE CUENTAN — nunca desaparecen.
      if (t.queryIds.length < minQueriesPerTheme) {
        continue;
      }

      t.queryIds.forEach((id) => usedIds.add(id));
      themes.push({
        label: t.label,
        queryIds: t.queryIds,
        esPreguntaDeConocimiento: t.esPreguntaDeConocimiento,
      });
    }

    const sinAgrupar = queries
      .map((q) => q.id)
      .filter((id) => !usedIds.has(id));
    return { themes, sinAgrupar };
  }
}
