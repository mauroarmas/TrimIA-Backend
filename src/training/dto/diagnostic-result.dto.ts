import { ApiProperty } from '@nestjs/swagger';

export class ModuleDiagnosticItemDto {
  @ApiProperty({ description: 'ID del módulo formativo' })
  id: string;

  @ApiProperty({ description: 'Título del módulo formativo' })
  title: string;
}

export class DiagnosticResultDto {
  @ApiProperty({ description: 'ID de la sesión de diagnóstico creada' })
  sessionId: string;

  @ApiProperty({ description: 'Porcentaje global de aciertos obtenido (0.0 a 100.0)', example: 85.7 })
  score: number;

  @ApiProperty({ description: 'Total de preguntas evaluadas' })
  totalQuestions: number;

  @ApiProperty({ description: 'Cantidad de preguntas respondidas correctamente' })
  correctAnswers: number;

  @ApiProperty({
    description: 'Módulos eximidos automáticamente tras lograr el 100% de aciertos',
    type: [ModuleDiagnosticItemDto],
  })
  exemptedModules: ModuleDiagnosticItemDto[];

  @ApiProperty({
    description: 'Módulos pendientes de cursado ordinario',
    type: [ModuleDiagnosticItemDto],
  })
  pendingModules: ModuleDiagnosticItemDto[];

  @ApiProperty({ description: 'Mensaje descriptivo del resultado' })
  message: string;
}
