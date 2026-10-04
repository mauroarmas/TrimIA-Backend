import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Audience } from '@prisma/client';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../ai/llm/llm.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { VerificationQuestion } from './dto/training-common.dto';

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
}
