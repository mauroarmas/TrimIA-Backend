import { ApiProperty } from '@nestjs/swagger';

export class SupervisorDiagnosticLastSessionDto {
  @ApiProperty({ description: 'ID de la sesión diagnóstica' })
  sessionId: string;

  @ApiProperty({ description: 'Puntaje porcentual obtenido', example: 75 })
  score: number;

  @ApiProperty({ description: 'Total de preguntas evaluadas', example: 8 })
  totalQuestions: number;

  @ApiProperty({ description: 'Respuestas correctas', example: 6 })
  correctAnswers: number;

  @ApiProperty({ description: 'IDs de los módulos eximidos' })
  exemptedModuleIds: string[];

  @ApiProperty({ description: 'Fecha y hora de finalización' })
  completedAt: Date;

  @ApiProperty({ description: 'Indica si la sesión fue reseteada' })
  isReset: boolean;
}

export class SupervisorDiagnosticDetailResponseDto {
  @ApiProperty({ description: 'ID del empleado' })
  employeeId: string;

  @ApiProperty({ description: 'Nombre completo del empleado' })
  employeeName: string;

  @ApiProperty({ description: 'Sector al que pertenece el empleado' })
  sectorName: string;

  @ApiProperty({ description: 'Indica si ha completado la evaluación diagnóstica' })
  hasCompletedDiagnostic: boolean;

  @ApiProperty({ description: 'Detalle de la última sesión diagnóstica', required: false, nullable: true })
  lastSession: SupervisorDiagnosticLastSessionDto | null;
}
