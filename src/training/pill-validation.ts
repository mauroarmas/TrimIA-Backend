import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const verificationQuestionSchema = z
  .object({
    id: z.number().int().positive(),
    question: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)).min(3).max(4),
    correctOptionIndex: z.number().int().nonnegative(),
    explanation: z.string().trim().min(1),
  })
  .refine((q) => q.correctOptionIndex < q.options.length, {
    message: 'La opción correcta debe existir entre las alternativas.',
  });

export const pillQuizSchema = z
  .array(verificationQuestionSchema)
  .length(2)
  .refine((questions) => new Set(questions.map((q) => q.id)).size === 2, {
    message: 'Los identificadores de las preguntas deben ser distintos.',
  });

export function validatePillContent(value: {
  title: string;
  objective: string;
  content: string;
  quiz: unknown;
}) {
  const quiz = Array.isArray(value.quiz)
    ? value.quiz
    : (value.quiz as any)?.questions;
  const result = z
    .object({
      title: z.string().trim().min(1),
      objective: z.string().trim().min(1),
      content: z.string().trim().min(1),
      quiz: pillQuizSchema,
    })
    .safeParse({ ...value, quiz });
  const steps = [
    ...(value.content || '').matchAll(
      /^(?:#{1,6}\s*)?Paso\s+(\d+)\s*[:.)-]|^(\d+)[.)]\s+/gim,
    ),
  ].map((m) => Number(m[1] ?? m[2]));
  if (
    !result.success ||
    steps.length < 3 ||
    steps.length > 6 ||
    steps.some((n, i) => n !== i + 1)
  ) {
    throw new BadRequestException(
      'La píldora requiere título, objetivo, 3 a 6 pasos numerados y exactamente 2 preguntas válidas con 3 a 4 opciones.',
    );
  }
  return result.data;
}
