import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { LlmService } from '../../../ai/llm/llm.service';
import {
  GeneratedScenario,
  TurnAiResponse,
  GeneratedFeedback,
} from '../interfaces/simulation-ai.interface';
import { PerformanceBand } from '@prisma/client';

const scenarioSchema = z.object({
  scenarioTitle: z
    .string()
    .trim()
    .min(1)
    .describe('Título breve y representativo del caso'),
  customerName: z
    .string()
    .trim()
    .min(1)
    .describe('Nombre y apellido del cliente ficticio'),
  customerProfile: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Perfil del cliente: motivo de contacto y tono emocional, sin inventar condiciones operativas',
    ),
  initialCustomerGreeting: z
    .string()
    .trim()
    .min(1)
    .describe('Primer mensaje con el que el cliente inicia la interacción'),
  goals: z
    .array(
      z.object({
        description: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Objetivo pedagógico observable que el empleado debe cumplir (verbo de acción)',
          ),
      }),
    )
    .min(3)
    .max(5)
    .describe('Checklist de 3 a 5 objetivos formativos para el caso'),
});

const guidedTurnSchema = z.object({
  customerResponse: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Respuesta del cliente simulado continuando la conversación en personaje',
    ),
  emotion: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Emoción actual del cliente: neutral, interesado, frustrado, satisfecho, desconfiado',
    ),
  evaluations: z
    .array(
      z.object({
        goalId: z
          .string()
          .trim()
          .min(1)
          .describe('ID exacto del objetivo evaluado'),
        isCompleted: z
          .boolean()
          .describe(
            'true si el mensaje del empleado cumplió satisfactoriamente este objetivo',
          ),
        evidence: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            'Cita breve del mensaje del empleado que fundamenta el cumplimiento',
          ),
      }),
    )
    .describe(
      'Evaluación de los objetivos del checklist contra el último mensaje del empleado',
    ),
});

const freeTurnSchema = z.object({
  customerResponse: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Respuesta del cliente simulado continuando la conversación en personaje',
    ),
  emotion: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Emoción actual del cliente: neutral, interesado, frustrado, satisfecho, desconfiado',
    ),
});

const feedbackSchema = z.object({
  band: z
    .enum(['ACHIEVED', 'NEEDS_IMPROVEMENT', 'NOT_ACHIEVED'])
    .describe('Banda cualitativa global de desempeño'),
  whatWentWellBand: z.enum(['ACHIEVED', 'NEEDS_IMPROVEMENT', 'NOT_ACHIEVED']),
  toImproveBand: z.enum(['ACHIEVED', 'NEEDS_IMPROVEMENT', 'NOT_ACHIEVED']),
  businessRulesBand: z.enum(['ACHIEVED', 'NEEDS_IMPROVEMENT', 'NOT_ACHIEVED']),
  whatWentWell: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Fortalezas demostradas por el empleado con citas textuales de la conversación',
    ),
  toImprove: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Puntos formativos a mejorar y recomendaciones pedagógicas concretas',
    ),
  businessRules: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Evaluación de adherencia únicamente al procedimiento aprobado de la píldora',
    ),
  summary: z.string().trim().min(1).describe('Síntesis formativa general'),
});

@Injectable()
export class SimulationAiService {
  private readonly logger = new Logger(SimulationAiService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Genera dinámicamente un caso de roleplay y el checklist de objetivos a partir de la píldora.
   */
  async generateScenario(pill: {
    title: string;
    objective: string;
    content: string;
  }): Promise<GeneratedScenario> {
    const prompt =
      'Sos un diseñador pedagógico y capacitador experto de Credimisión (empresa comercial y de créditos en Argentina).\n' +
      'A partir del contenido de la píldora formativa, creá un escenario de roleplay creíble para que un nuevo empleado practique.\n' +
      'El cliente simulado debe tener un nombre realista, una consulta concreta del tema de la píldora, objeciones típicas y un tono coherente.\n' +
      'Basate solo en la píldora. No inventes tasas, plazos, reglas ni requisitos ni fuerces un caso financiero si el tema es otro.\n' +
      'El checklist debe tener entre 3 y 5 objetivos claros, específicos y observables que el empleado deba realizar durante la conversación.';

    const structured = this.llm.chat.withStructuredOutput(scenarioSchema, {
      name: 'generate_scenario',
    });

    try {
      const result = scenarioSchema.parse(
        await structured.invoke([
          new SystemMessage(prompt),
          new HumanMessage(
            `Píldora: "${pill.title}"\nObjetivo pedagógico: ${pill.objective}\nContenido de referencia:\n${pill.content}`,
          ),
        ]),
      );

      return {
        scenarioTitle: result.scenarioTitle,
        customerName: result.customerName,
        customerProfile: result.customerProfile,
        initialCustomerGreeting: result.initialCustomerGreeting,
        goals: result.goals.map((g) => ({ description: g.description })),
      };
    } catch (err) {
      this.logger.error(`Error al generar escenario de simulación: ${err}`);
      throw new ServiceUnavailableException(
        'No se pudo preparar la práctica. Intentá nuevamente; no se creó una sesión.',
      );
    }
  }

  /**
   * Genera una pista orientativa para Trimi en la práctica guiada sin dar la respuesta armada.
   */
  async generateHint(params: {
    goalDescription: string;
    customerName: string;
    customerProfile: string;
    conversationHistory: Array<{ sender: string; content: string }>;
  }): Promise<{ hint: string }> {
    const prompt =
      'Sos Trimi, el simpático personaje y asistente de capacitación de Credimisión en Argentina.\n' +
      'El empleado nuevo está en una práctica guiada y te pidió una pista para cumplir el siguiente objetivo pedagógico sin darle la respuesta servida ni armada.\n' +
      'Dale una sugerencia breve (1 o 2 oraciones), cordial y orientativa en español rioplatense (usá voseo: "recordá", "preguntale", "fijate"), que lo guíe sobre qué preguntar o verificar para destrabarse.';

    const hintSchema = z.object({
      hint: z.string().describe('Pista corta y orientativa redactada por Trimi con voseo sin dar la respuesta armada'),
    });

    const structured = this.llm.chat.withStructuredOutput(hintSchema, {
      name: 'generate_hint',
    });

    try {
      const historyText = params.conversationHistory
        .map((m) => `${m.sender === 'EMPLOYEE' ? 'Empleado' : params.customerName}: ${m.content}`)
        .join('\n');

      const result = (await structured.invoke([
        new SystemMessage(prompt),
        new HumanMessage(
          `Cliente: ${params.customerName}\nPerfil: ${params.customerProfile}\nObjetivo pendiente a cumplir: "${params.goalDescription}"\nConversación hasta ahora:\n${historyText}`,
        ),
      ])) as z.infer<typeof hintSchema>;

      return { hint: result.hint };
    } catch (err) {
      this.logger.warn(`Error al generar pista con IA, usando fallback: ${err}`);
      return {
        hint: `Para cumplir el objetivo «${params.goalDescription}», fijate en consultar con amabilidad los datos del cliente o validar su estado en el sistema antes de avanzar.`,
      };
    }
  }

  /**
   * Genera el turno del cliente simulado.
   * En modo GUIDED, evalúa simultáneamente en una sola llamada los objetivos del checklist.
   */
  async generateTurnResponse(params: {
    mode: 'GUIDED' | 'FREE';
    customerName: string;
    customerProfile: string;
    conversationHistory: {
      sender: 'EMPLOYEE' | 'SIMULATED_CLIENT';
      content: string;
    }[];
    latestEmployeeMessage: string;
    pendingGoals?: { id: string; description: string }[];
  }): Promise<TurnAiResponse> {
    const historyText = params.conversationHistory
      .map(
        (m) =>
          `${m.sender === 'EMPLOYEE' ? 'Empleado' : params.customerName}: ${m.content}`,
      )
      .join('\n');

    const systemPrompt =
      `Sos ${params.customerName}, un cliente real de Credimisión en Argentina.\n` +
      `Tu perfil y situación: ${params.customerProfile}\n\n` +
      'REGLAS DE ACTUACIÓN (NO NEGOCIABLES):\n' +
      '1. Mantené tu personaje en todo momento con tono natural argentino (trato de vos o usted según tu perfil).\n' +
      '2. NO reveles que sos una IA ni que esto es una prueba o simulación.\n' +
      '3. NO respondas con lenguaje técnico de sistemas, ni menciones prompts, modelos ni bases de datos.\n' +
      '4. Si el empleado te pregunta algo extraño o fuera de contexto, reaccioná desconcertado como cliente real.\n' +
      '5. Respondé de forma conversacional (1 a 3 oraciones por turno, como en un chat de WhatsApp o mostrador).\n' +
      '6. Colaborá si el empleado te atiende bien y responde tus dudas, o mostrate más firme si no te da respuestas claras.';

    if (
      params.mode === 'GUIDED' &&
      params.pendingGoals &&
      params.pendingGoals.length > 0
    ) {
      const goalsText = params.pendingGoals
        .map((g) => `- [ID: ${g.id}]: ${g.description}`)
        .join('\n');

      const evaluationPrompt =
        systemPrompt +
        '\n\nEVALUACIÓN PEDAGÓGICA ADICIONAL:\n' +
        'Además de tu respuesta como cliente, evaluá si el último mensaje del empleado cumplió alguno de los siguientes objetivos pendientes del checklist:\n' +
        `${goalsText}\n` +
        'Marcá `isCompleted: true` ÚNICAMENTE si el mensaje del empleado abordó o satisfizo el objetivo de manera verificable, e incluí la cita textual breve en `evidence`.';

      const structured = this.llm.chat.withStructuredOutput(guidedTurnSchema, {
        name: 'guided_turn_response',
      });

      try {
        const result = guidedTurnSchema.parse(
          await structured.invoke([
            new SystemMessage(evaluationPrompt),
            new HumanMessage(
              `Historial previo:\n${historyText}\n\nÚltimo mensaje del Empleado:\n"${params.latestEmployeeMessage}"`,
            ),
          ]),
        );

        return {
          customerResponse: result.customerResponse,
          emotion: result.emotion || 'neutral',
          completedGoalEvaluations: result.evaluations.map((e) => ({
            goalId: e.goalId,
            isCompleted: e.isCompleted,
            evidence: e.evidence,
          })),
        };
      } catch (err) {
        this.logger.error(`Error en turno guiado de simulación: ${err}`);
        throw new ServiceUnavailableException(
          'No se pudo responder. El turno no se guardó; podés reintentarlo.',
        );
      }
    } else {
      const structured = this.llm.chat.withStructuredOutput(freeTurnSchema, {
        name: 'free_turn_response',
      });

      try {
        const result = freeTurnSchema.parse(
          await structured.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(
              `Historial previo:\n${historyText}\n\nÚltimo mensaje del Empleado:\n"${params.latestEmployeeMessage}"`,
            ),
          ]),
        );

        return {
          customerResponse: result.customerResponse,
          emotion: result.emotion || 'neutral',
        };
      } catch (err) {
        this.logger.error(`Error en turno libre de simulación: ${err}`);
        throw new ServiceUnavailableException(
          'No se pudo responder. El turno no se guardó; podés reintentarlo.',
        );
      }
    }
  }

  /**
   * Genera la devolución cualitativa final estructurada en exactamente 3 tarjetas y bandas de desempeño.
   */
  async generateFeedback(params: {
    scenarioTitle: string;
    customerProfile: string;
    pillObjective: string;
    pillContent: string;
    sector: string;
    conversationTranscript: {
      sender: 'EMPLOYEE' | 'SIMULATED_CLIENT';
      content: string;
    }[];
  }): Promise<GeneratedFeedback> {
    const transcriptText = params.conversationTranscript
      .map(
        (m) =>
          `[${m.sender === 'EMPLOYEE' ? 'Empleado' : 'Cliente'}]: ${m.content}`,
      )
      .join('\n');

    const prompt =
      'Sos un auditor y capacitador de calidad de atención en Credimisión.\n' +
      'Tu tarea es analizar la interacción completa entre un empleado en entrenamiento y un cliente simulado.\n' +
      'Debes emitir una evaluación pedagógica en exactamente 3 dimensiones cualitativas y clasificar el desempeño en una banda:\n\n' +
      '1. "whatWentWell" (Qué hizo bien): Fortalezas observadas, empatía, claridad, con citas textuales del chat.\n' +
      '2. "toImprove" (A mejorar): Aspectos a pulir, respuestas incompletas, tono o falta de información clave.\n' +
      '3. "businessRules" (Reglas del negocio): Cumplimiento únicamente del procedimiento aprobado que se adjunta. No supongas normas, tasas o requisitos ausentes.\n' +
      '4. "band": Asignar exactamente una de las siguientes bandas cualitativas:\n' +
      '   - ACHIEVED (Logrado): Cumplió el objetivo formativo y respetó las normas de atención.\n' +
      '   - NEEDS_IMPROVEMENT (A mejorar): Tuvo buena predisposición pero omitió validaciones clave o reglas secundarias.\n' +
      '   - NOT_ACHIEVED (No logrado): Incumplió reglas críticas de negocio o no logró resolver la interacción.\n\n' +
      'Asigná también una banda a cada dimensión: whatWentWellBand, toImproveBand, businessRulesBand. Basá cada valoración en citas de la charla y el procedimiento, sin inventar fortalezas ni penalizar requisitos que no figuran.\n' +
      'PROHIBICIÓN ESTRICTA: NO uses notas ni puntuaciones numéricas de 0 a 100.';

    const structured = this.llm.chat.withStructuredOutput(feedbackSchema, {
      name: 'generate_feedback',
    });

    try {
      const result = feedbackSchema.parse(
        await structured.invoke([
          new SystemMessage(prompt),
          new HumanMessage(
            `Escenario: ${params.scenarioTitle}\n` +
              `Objetivo de la píldora: ${params.pillObjective}\n` +
              `Sector: ${params.sector}\nProcedimiento aprobado:\n${params.pillContent}\n` +
              `Perfil del cliente: ${params.customerProfile}\n\n` +
              `Transcripción de la charla:\n${transcriptText}`,
          ),
        ]),
      );

      return {
        band: result.band as PerformanceBand,
        whatWentWellBand: result.whatWentWellBand as PerformanceBand,
        toImproveBand: result.toImproveBand as PerformanceBand,
        businessRulesBand: result.businessRulesBand as PerformanceBand,
        whatWentWell: result.whatWentWell,
        toImprove: result.toImprove,
        businessRules: result.businessRules,
        summary: result.summary,
      };
    } catch (err) {
      this.logger.error(`Error al generar feedback cualitativo: ${err}`);
      throw new ServiceUnavailableException(
        'No se pudo evaluar la práctica. La sesión sigue abierta para reintentar.',
      );
    }
  }
}
