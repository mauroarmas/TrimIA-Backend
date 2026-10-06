import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsUUID, Min, ValidateNested } from 'class-validator';

export class DiagnosticSubmissionAnswerDto {
  @ApiProperty({ description: 'ID de la píldora a la que pertenece la pregunta' })
  @IsUUID()
  @IsNotEmpty()
  pillId: string;

  @ApiProperty({ description: 'Identificador numérico de la pregunta dentro de la píldora' })
  @IsInt()
  @Min(0)
  questionId: number;

  @ApiProperty({ description: 'Índice de la opción elegida por el empleado (0 a 3)' })
  @IsInt()
  @Min(0)
  selectedOptionIndex: number;
}

export class SubmitDiagnosticDto {
  @ApiProperty({
    description: 'Respuestas seleccionadas para cada una de las preguntas del diagnóstico',
    type: [DiagnosticSubmissionAnswerDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagnosticSubmissionAnswerDto)
  answers: DiagnosticSubmissionAnswerDto[];
}
