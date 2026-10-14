import { Injectable, Logger } from '@nestjs/common';
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
  scenarioTitle: z.string().describe('Título breve y representativo del caso'),
  customerName: z.string().describe('Nombre y apellido del cliente ficticio'),
  customerProfile: z.string().describe('Perfil del cliente: ocupación, ingresos, motivo de contacto, tono emocional e historial crediticio'),
  initialCustomerGreeting: z.string().describe('Primer mensaje con el que el cliente inicia la interacción'),
  goals: z
    .array(
      z.object({
        description: z.string().describe('Objetivo pedagógico observable que el empleado debe cumplir (verbo de acción)'),
      }),
    )
    .min(3)
    .max(5)
    .describe('Checklist de 3 a 5 objetivos formativos para el caso'),
});

const guidedTurnSchema = z.object({
  customerResponse: z.string().describe('Respuesta del cliente simulado continuando la conversación en personaje'),
  emotion: z.string().describe('Emoción actual del cliente: neutral, interesado, frustrado, satisfecho, desconfiado'),
  evaluations: z
    .array(
      z.object({
        goalId: z.string().describe('ID exacto del objetivo evaluado'),
        isCompleted: z.boolean().describe('true si el mensaje del empleado cumplió satisfactoriamente este objetivo'),
        evidence: z.string().optional().describe('Cita breve del mensaje del empleado que fundamenta el cumplimiento'),
      }),
    )
    .describe('Evaluación de los objetivos del checklist contra el último mensaje del empleado'),
});

const freeTurnSchema = z.object({
  customerResponse: z.string().describe('Respuesta del cliente simulado continuando la conversación en personaje'),
  emotion: z.string().describe('Emoción actual del cliente: neutral, interesado, frustrado, satisfecho, desconfiado'),
});

const feedbackSchema = z.object({
  band: z
    .enum(['ACHIEVED', 'NEEDS_IMPROVEMENT', 'NOT_ACHIEVED'])
    .describe('Banda cualitativa global de desempeño'),
  whatWentWell: z.string().describe('Fortalezas demostradas por el empleado con citas textuales de la conversación'),
  toImprove: z.string().describe('Puntos formativos a mejorar y recomendaciones pedagógicas concretas'),
  businessRules: z.string().describe('Evaluación de adherencia a políticas, tasas, validación de identidad y procedimientos de Credimisión'),
  summary: z.string().describe('Síntesis formativa general'),
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
      'El cliente simulado debe tener un nombre realista, una necesidad financiera o consulta concreta, objeciones típicas y un tono coherente.\n' +
      'El checklist debe tener entre 3 y 5 objetivos claros, específicos y observables que el empleado deba realizar durante la conversación.';

    const structured = this.llm.chat.withStructuredOutput(scenarioSchema, {
      name: 'generate_scenario',
    });

    try {
      const result = (await structured.invoke([
        new SystemMessage(prompt),
        new HumanMessage(
          `Píldora: "${pill.title}"\nObjetivo pedagógico: ${pill.objective}\nContenido de referencia:\n${pill.content}`,
        ),
      ])) as z.infer<typeof scenarioSchema>;

      return {
        scenarioTitle: result.scenarioTitle,
        customerName: result.customerName,
        customerProfile: result.customerProfile,
        initialCustomerGreeting: result.initialCustomerGreeting,
        goals: result.goals.map((g) => ({ description: g.description })),
      };
    } catch (err) {
      this.logger.error(`Error al generar escenario de simulación: ${err}`);
      return {
        scenarioTitle: `Práctica sobre ${pill.title}`,
        customerName: 'Carlos Benítez',
        customerProfile: 'Cliente interesado en consultar condiciones de financiación pero con dudas sobre tasas y cuotas.',
        initialCustomerGreeting: 'Hola, buenas tardes. Quería consultar sobre los planes de crédito que tienen disponibles.',
        goals: [
          { description: 'Saludar con cortesía y solicitar datos de contacto o DNI' },
          { description: 'Identificar la necesidad concreta del cliente' },
          { description: 'Explicar con claridad las opciones disponibles y requisitos' },
          { description: 'Ofrecer alternativas ante objeciones y cerrar el contacto cordial' },
        ],
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
    conversationHistory: { sender: 'EMPLOYEE' | 'SIMULATED_CLIENT'; content: string }[];
    latestEmployeeMessage: string;
    pendingGoals?: { id: string; description: string }[];
  }): Promise<TurnAiResponse> {
    const historyText = params.conversationHistory
      .map((m) => `${m.sender === 'EMPLOYEE' ? 'Empleado' : params.customerName}: ${m.content}`)
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

    if (params.mode === 'GUIDED' && params.pendingGoals && params.pendingGoals.length > 0) {
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
        const result = (await structured.invoke([
          new SystemMessage(evaluationPrompt),
          new HumanMessage(
            `Historial previo:\n${historyText}\n\nÚltimo mensaje del Empleado:\n"${params.latestEmployeeMessage}"`,
          ),
        ])) as z.infer<typeof guidedTurnSchema>;

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
        return {
          customerResponse: 'Entiendo lo que me decís. ¿Cómo seguimos entonces?',
          emotion: 'neutral',
          completedGoalEvaluations: [],
        };
      }
    } else {
      const structured = this.llm.chat.withStructuredOutput(freeTurnSchema, {
        name: 'free_turn_response',
      });

      try {
        const result = (await structured.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(
            `Historial previo:\n${historyText}\n\nÚltimo mensaje del Empleado:\n"${params.latestEmployeeMessage}"`,
          ),
        ])) as z.infer<typeof freeTurnSchema>;

        return {
          customerResponse: result.customerResponse,
          emotion: result.emotion || 'neutral',
        };
      } catch (err) {
        this.logger.error(`Error en turno libre de simulación: ${err}`);
        return {
          customerResponse: 'Perfecto, comprendo. ¿Cuáles serían los pasos a seguir?',
          emotion: 'neutral',
        };
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
    conversationTranscript: { sender: 'EMPLOYEE' | 'SIMULATED_CLIENT'; content: string }[];
  }): Promise<GeneratedFeedback> {
    const transcriptText = params.conversationTranscript
      .map((m) => `[${m.sender === 'EMPLOYEE' ? 'Empleado' : 'Cliente'}]: ${m.content}`)
      .join('\n');

    const prompt =
      'Sos un auditor y capacitador de calidad de atención en Credimisión.\n' +
      'Tu tarea es analizar la interacción completa entre un empleado en entrenamiento y un cliente simulado.\n' +
      'Debes emitir una evaluación pedagógica en exactamente 3 dimensiones cualitativas y clasificar el desempeño en una banda:\n\n' +
      '1. "whatWentWell" (Qué hizo bien): Fortalezas observadas, empatía, claridad, con citas textuales del chat.\n' +
      '2. "toImprove" (A mejorar): Aspectos a pulir, respuestas incompletas, tono o falta de información clave.\n' +
      '3. "businessRules" (Reglas del negocio): Cumplimiento de políticas de Credimisión (verificación de identidad, explicación de tasas/cuotas, formalización de acuerdos).\n' +
      '4. "band": Asignar exactamente una de las siguientes bandas cualitativas:\n' +
      '   - ACHIEVED (Logrado): Cumplió el objetivo formativo y respetó las normas de atención.\n' +
      '   - NEEDS_IMPROVEMENT (A mejorar): Tuvo buena predisposición pero omitió validaciones clave o reglas secundarias.\n' +
      '   - NOT_ACHIEVED (No logrado): Incumplió reglas críticas de negocio o no logró resolver la interacción.\n\n' +
      'PROHIBICIÓN ESTRICTA: NO uses notas ni puntuaciones numéricas de 0 a 100.';

    const structured = this.llm.chat.withStructuredOutput(feedbackSchema, {
      name: 'generate_feedback',
    });

    try {
      const result = (await structured.invoke([
        new SystemMessage(prompt),
        new HumanMessage(
          `Escenario: ${params.scenarioTitle}\n` +
            `Objetivo de la píldora: ${params.pillObjective}\n` +
            `Perfil del cliente: ${params.customerProfile}\n\n` +
            `Transcripción de la charla:\n${transcriptText}`,
        ),
      ])) as z.infer<typeof feedbackSchema>;

      return {
        band: result.band as PerformanceBand,
        whatWentWell: result.whatWentWell,
        toImprove: result.toImprove,
        businessRules: result.businessRules,
        summary: result.summary,
      };
    } catch (err) {
      this.logger.error(`Error al generar feedback cualitativo: ${err}`);
      return {
        band: PerformanceBand.NEEDS_IMPROVEMENT,
        whatWentWell: 'Se observó predisposición para atender la consulta del cliente.',
        toImprove: 'Revisar la validación completa de datos y el cierre formal del acuerdo.',
        businessRules: 'Asegurar siempre la confirmación del DNI y las condiciones del préstamo.',
        summary: 'Práctica completada. Se sugiere repasar la teoría de la píldora antes de volver a intentar.',
      };
    }
  }
}
