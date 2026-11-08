import { ApiProperty } from '@nestjs/swagger';

export class DiagnosticQuestionDto {
  @ApiProperty({ description: 'ID del módulo formativo al que pertenece la pregunta' })
  moduleId: string;

  @ApiProperty({ description: 'Título del módulo formativo' })
  moduleTitle: string;

  @ApiProperty({ description: 'ID de la píldora formativa' })
  pillId: string;

  @ApiProperty({ description: 'Título de la píldora' })
  pillTitle: string;

  @ApiProperty({ description: 'Identificador de la pregunta dentro de la píldora (1 o 2)' })
  questionId: number;

  @ApiProperty({ description: 'Texto del enunciado de la pregunta' })
  question: string;

  @ApiProperty({ description: 'Opciones de respuesta disponibles (3 a 4 opciones)', type: [String] })
  options: string[];
}

export class DiagnosticQuizResponseDto {
  @ApiProperty({ description: 'Cantidad total de preguntas seleccionadas para el diagnóstico' })
  totalQuestions: number;

  @ApiProperty({ description: 'Tiempo estimado en minutos para completar la prueba', example: 5 })
  estimatedMinutes: number;

  @ApiProperty({ description: 'Listado balanceado y sanitizado de preguntas', type: [DiagnosticQuestionDto] })
  questions: DiagnosticQuestionDto[];
}
