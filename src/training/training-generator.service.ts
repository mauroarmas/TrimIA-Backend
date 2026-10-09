import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Audience } from '@prisma/client';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../ai/llm/llm.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { VerificationQuestion } from './dto/training-common.dto';
import { AudioScriptDto, SpeakerRole } from './dto/audio-script.dto';

const generatedPillSchema = z.object({
  title: z
    .string()
    .describe('Título conciso y profesional del procedimiento o lección'),
  objective: z
    .string()
    .describe('Objetivo pedagógico claro: qué aprenderá o sabrá ejecutar el empleado'),
  steps: z
    .array(
      z.object({
        stepNumber: z.number(),
        title: z.string().describe('Título breve del paso'),
        instruction: z.string().describe('Explicación detallada de la acción a realizar'),
      }),
    )
    .min(2)
    .max(6)
    .describe('Pasos secuenciales del procedimiento'),
  quiz: z
    .array(
      z.object({
        id: z.number(),
        question: z.string().describe('Pregunta de opción múltiple sobre las reglas o pasos del procedimiento'),
        options: z.array(z.string()).min(3).max(4).describe('Opciones posibles (3 o 4)'),
        correctOptionIndex: z.number().min(0).max(3).describe('Índice de la opción correcta (0 a N-1)'),
        explanation: z.string().describe('Explicación didáctica de la regla aplicada'),
      }),
    )
    .length(2)
    .describe('Exactamente dos preguntas de verificación'),
});

export type GeneratedPillResult = {
  title: string;
  objective: string;
  content: string;
  quiz: VerificationQuestion[];
};

const SYSTEM_PROMPT = `Sos el generador pedagógico de capacitación interna de Credimisión S.R.L. (empresa comercial de Misiones, Argentina).
Tu objetivo es redactar lecciones operativas ("píldoras de capacitación") para empleados nuevos, estructuradas en pasos claros y con autoevaluación.

REGLAS ESTRICTAS (Principio II - Cero Alucinación):
1. Basate ÚNICAMENTE en la documentación corporativa y respuestas de entrevistas suministradas.
2. NO inventes procedimientos, plazos, tasas ni requisitos no especificados en el contexto.
3. El contenido debe estructurarse en pasos operativos numerados y claros.
4. Generá EXACTAMENTE 2 preguntas de autoevaluación con sus opciones, el índice correcto y una justificación pedagógica clara.
5. El tono debe ser profesional, didáctico y adaptado al contexto operativo de Argentina.`;

const generatedAudioScriptSchema = z.object({
  title: z
    .string()
    .describe('Título conciso y atractivo del guion del episodio formativo'),
  dialogue: z
    .array(
      z.object({
        speaker: z
          .enum(['SPEAKER_1', 'SPEAKER_2'])
          .describe(
            'Rol del locutor: SPEAKER_1 (Conductor/a o instructor/a principal) o SPEAKER_2 (Colega que hace preguntas, reflexiones y síntesis)',
          ),
        text: z
          .string()
          .describe(
            'Intervención hablada natural en español rioplatense (Argentina), pedagógica, concisa y basada estrictamente en el contenido provisto',
          ),
      }),
    )
    .min(4)
    .max(14)
    .describe('Diálogo conversacional dinámico y alternado entre SPEAKER_1 y SPEAKER_2'),
});

const AUDIO_SCRIPT_SYSTEM_PROMPT = `Sos un pedagogo y guionista experto en capacitación operativa para Credimisión S.R.L. (Misiones, Argentina).
Tu objetivo es transformar el procedimiento y la base de conocimiento en un podcast conversacional a DOS VOCES (SPEAKER_1 y SPEAKER_2).

REGLAS ESTRICTAS DE CONTENIDO (Principio II - Cero Alucinación):
1. Basate EXCLUSIVAMENTE en el procedimiento y la documentación de la base de conocimiento suministrados.
2. NO inventes pasos, plazos, tasas de interés, montos ni requisitos que no estén en los textos dados.
3. El diálogo debe explicar con total claridad el procedimiento paso a paso, destacando qué debe hacer el empleado, los errores comunes a evitar y los tips prácticos.

ROLES Y DINÁMICA DE CONVERSACIÓN:
- SPEAKER_1 (Conductor/a / Guía): Introduce el tema brevemente, explica la lógica de los pasos operativos y aclara los puntos críticos.
- SPEAKER_2 (Colega / Copresentador/a): Formula las dudas típicas del día a día, pide aclaraciones ("¿Y qué pasa si...?", "¿Dónde chequeo eso?", "O sea que primero..."), y sintetiza las conclusiones.
- Modismos: Español rioplatense profesional y amigable (ej. "fijate", "tené en cuenta", "dale", "impecable").
- Cada intervención debe tener entre 1 y 3 oraciones (15 a 45 palabras) para que la locución oral suene fluida y espontánea.
- Alternar constantemente entre SPEAKER_1 y SPEAKER_2 (mínimo 4 y máximo 14 turnos).`;

@Injectable()
export class TrainingGeneratorService {
  private readonly logger = new Logger(TrainingGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /**
   * Genera el contenido de una píldora formativa consultando la base de conocimiento y entrevistas.
   */
  async generatePillProposal(
    topic: string,
    sectorId?: string | null,
    additionalNotes?: string,
  ): Promise<GeneratedPillResult> {
    // 1. Búsqueda de contexto en la base de conocimiento RAG (audiencia INTERNO)
    const hits = await this.knowledge.search(topic, {
      audience: Audience.INTERNO,
      k: 4,
    });

    // 2. Búsqueda de entrevistas del sector si corresponde
    let interviewContext = '';
    if (sectorId) {
      const interviewQuestions = await this.prisma.interviewQuestion.findMany({
        where: {
          session: { sectorId },
          answers: { some: {} },
        },
        take: 4,
        select: {
          text: true,
          answers: {
            select: { text: true },
            take: 1,
            orderBy: { attempt: 'desc' },
          },
        },
      });

      if (interviewQuestions.length > 0) {
        interviewContext = interviewQuestions
          .filter((iq) => iq.answers.length > 0)
          .map((iq) => `Pregunta: ${iq.text}\nRespuesta del responsable: ${iq.answers[0].text}`)
          .join('\n\n');
      }
    }

    // 3. Validación de suficiencia de contexto (Principio II)
    const hasKnowledge = hits && hits.length > 0;
    const hasInterviews = interviewContext.trim().length > 0;

    if (!hasKnowledge && !hasInterviews) {
      throw new BadRequestException(
        `No se encontró información suficiente en la base de conocimiento ni en entrevistas sobre "${topic}". ` +
          `Cargue documentación o realice una entrevista de capacitación antes de generar esta píldora.`,
      );
    }

    const knowledgeContext = (hits || [])
      .map((h, i) => `[Doc ${i + 1}: ${h.title} (Score: ${h.score.toFixed(2)})]\n${h.content}`)
      .join('\n\n');

    const promptContext = `TEMA SOLICITADO: ${topic}\n\n` +
      (additionalNotes ? `NOTAS ADICIONALES DEL SUPERVISOR:\n${additionalNotes}\n\n` : '') +
      `DOCUMENTACIÓN DISPONIBLE:\n${knowledgeContext}\n\n` +
      (hasInterviews ? `ENTREVISTAS PREVIAS DEL SECTOR:\n${interviewContext}\n\n` : '');

    // 4. Invocación a Gemini con Structured Output
    const structuredModel = this.llm.chat.withStructuredOutput(generatedPillSchema, {
      name: 'generate_pill_proposal',
    });

    try {
      const result = (await structuredModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(promptContext),
      ])) as z.infer<typeof generatedPillSchema>;

      // Formatear pasos a Markdown estructurado
      const formattedMarkdown = result.steps
        .map((s) => `### Paso ${s.stepNumber}: ${s.title}\n\n${s.instruction}`)
        .join('\n\n');

      return {
        title: result.title,
        objective: result.objective,
        content: formattedMarkdown,
        quiz: result.quiz.map((q, idx) => ({
          id: idx + 1,
          question: q.question,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation,
        })),
      };
    } catch (err) {
      this.logger.error(`Error generando propuesta de píldora para tema "${topic}": ${err}`);
      throw new BadRequestException(
        `Error al estructurar la píldora con IA: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async generateAudioScript(params: {
    title: string;
    objective: string;
    content: string;
    sectorId?: string | null;
    targetDurationSeconds?: number;
  }): Promise<AudioScriptDto> {
    const targetSeconds = params.targetDurationSeconds
      ? Math.max(30, Math.min(600, Math.round(params.targetDurationSeconds)))
      : 90;
    const targetWords = Math.round((targetSeconds / 60) * 140);
    const minTurns = Math.max(4, Math.floor(targetWords / 35));
    const maxTurns = Math.max(minTurns + 2, Math.ceil(targetWords / 18));

    // 1. Búsqueda en la base de conocimiento con RAG semántico (audiencia INTERNO)
    const query = `${params.title} ${params.objective}`;
    let hits: any[] = [];
    try {
      hits = await this.knowledge.search(query, {
        audience: Audience.INTERNO,
        k: 4,
      });
    } catch (e) {
      this.logger.warn(`Error buscando en base de conocimiento para guion de audio: ${e}`);
    }

    // 2. Búsqueda de entrevistas previas del sector si corresponde
    let interviewContext = '';
    if (params.sectorId) {
      try {
        const interviewQuestions = await this.prisma.interviewQuestion.findMany({
          where: {
            session: { sectorId: params.sectorId },
            answers: { some: {} },
          },
          take: 3,
          select: {
            text: true,
            answers: {
              select: { text: true },
              take: 1,
              orderBy: { attempt: 'desc' },
            },
          },
        });
        if (interviewQuestions.length > 0) {
          interviewContext = interviewQuestions
            .filter((iq) => iq.answers.length > 0)
            .map((iq) => `Pregunta: ${iq.text}\nRespuesta de referencia: ${iq.answers[0].text}`)
            .join('\n\n');
        }
      } catch (e) {
        this.logger.warn(`Error buscando entrevistas del sector ${params.sectorId}: ${e}`);
      }
    }

    const knowledgeContext = (hits || [])
      .map((h, i) => `[Doc ${i + 1}: ${h.title}]\n${h.content}`)
      .join('\n\n');

    const promptContext =
      `LECCIÓN A EXPLICAR:\n` +
      `Título: ${params.title}\n` +
      `Objetivo pedagógico: ${params.objective}\n\n` +
      `DURACIÓN SOLICITADA POR EL SUPERVISOR:\n` +
      `- Tiempo objetivo: ${targetSeconds} segundos (${(targetSeconds / 60).toFixed(1)} minutos).\n` +
      `- Extensión requerida: Aproximadamente ${targetWords} palabras habladas en total entre ambos locutores.\n` +
      `- Turnos recomendados: Entre ${minTurns} y ${maxTurns} turnos de diálogo alternados.\n` +
      `- REGLA DE CALIBRACIÓN: Adaptá el nivel de detalle y la cantidad de turnos al tiempo solicitado. No agregues relleno, pero asegurate de cubrir los puntos críticos y cumplir el tiempo pedido.\n\n` +
      `PROCEDIMIENTO OPERATIVO (CONTENIDO DE LA PÍLDORA):\n` +
      `${params.content}\n\n` +
      (knowledgeContext
        ? `DOCUMENTACIÓN DE LA BASE DE CONOCIMIENTO:\n${knowledgeContext}\n\n`
        : '') +
      (interviewContext
        ? `REFERENCIAS DE ENTREVISTAS DEL SECTOR:\n${interviewContext}\n\n`
        : '');

    // 3. Invocación a Gemini con Structured Output
    const structuredModel = this.llm.chat.withStructuredOutput(generatedAudioScriptSchema, {
      name: 'generate_audio_script',
    });

    try {
      const result = (await structuredModel.invoke([
        new SystemMessage(AUDIO_SCRIPT_SYSTEM_PROMPT),
        new HumanMessage(promptContext),
      ])) as z.infer<typeof generatedAudioScriptSchema>;

      const totalWords = result.dialogue.reduce(
        (acc, line) => acc + line.text.trim().split(/\s+/).filter(Boolean).length,
        0,
      );
      const computedDuration = Math.max(30, Math.ceil((totalWords / 140) * 60));

      return {
        title: result.title || `${params.title} - Guion a 2 Voces`,
        estimatedDurationSeconds: computedDuration,
        dialogue: result.dialogue.map((d) => ({
          speaker: d.speaker === 'SPEAKER_2' ? SpeakerRole.SPEAKER_2 : SpeakerRole.SPEAKER_1,
          text: d.text,
        })),
      };
    } catch (err) {
      this.logger.error(`Error generando guion con IA para "${params.title}": ${err}`);
      return this.generateFallbackScript({ ...params, targetDurationSeconds: targetSeconds });
    }
  }

  private generateFallbackScript(params: {
    title: string;
    objective: string;
    content: string;
    targetDurationSeconds?: number;
  }): AudioScriptDto {
    const rawSteps = params.content
      .split('\n\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const fallbackDialogue: { speaker: SpeakerRole; text: string }[] = [
      {
        speaker: SpeakerRole.SPEAKER_1,
        text: `Hola a todos. Hoy vamos a repasar "${params.title}". Nuestro objetivo central es ${params.objective.toLowerCase().replace(/\.$/, '')}.`,
      },
      {
        speaker: SpeakerRole.SPEAKER_2,
        text: '¡Hola! Es un procedimiento clave para nuestra operatoria en Credimisión. ¿Cuál es el primer paso?',
      },
    ];

    for (let i = 0; i < Math.min(rawSteps.length, 4); i++) {
      const cleanStep = rawSteps[i].replace(/^###\s+/, '').replace(/\*\*/g, '');
      if (i % 2 === 0) {
        fallbackDialogue.push({
          speaker: SpeakerRole.SPEAKER_1,
          text: `En primer lugar: ${cleanStep}. Es crucial prestar atención a cada detalle aquí.`,
        });
      } else {
        fallbackDialogue.push({
          speaker: SpeakerRole.SPEAKER_2,
          text: `Perfecto. Y sobre ${cleanStep}, ¿qué recomendación debemos tener en cuenta?`,
        });
      }
    }

    fallbackDialogue.push({
      speaker: SpeakerRole.SPEAKER_1,
      text: 'Siempre recordar verificar el sistema corporativo y consultar con el supervisor ante cualquier discrepancia.',
    });
    fallbackDialogue.push({
      speaker: SpeakerRole.SPEAKER_2,
      text: 'Excelente, con estos pasos claros ya estamos listos para aplicarlo en el día a día.',
    });

    const totalWords = fallbackDialogue.reduce(
      (acc, l) => acc + l.text.split(/\s+/).filter(Boolean).length,
      0,
    );

    return {
      title: `${params.title} - Guion a 2 Voces`,
      estimatedDurationSeconds:
        params.targetDurationSeconds || Math.max(30, Math.ceil((totalWords / 140) * 60)),
      dialogue: fallbackDialogue,
    };
  }
}