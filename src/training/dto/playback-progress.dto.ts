import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ReportPlaybackProgressDto {
  @ApiProperty({
    description: 'Segundo actual alcanzado en el reproductor de audio',
    example: 45,
  })
  @IsInt()
  @Min(0)
  currentSeconds: number;
}

export class PlaybackProgressResponseDto {
  @ApiProperty({ description: 'ID de la píldora formativa' })
  pillId: string;

  @ApiProperty({ description: 'Segundos reproducidos acumulados y validados', example: 75 })
  playbackProgressSeconds: number;

  @ApiProperty({ description: 'Duración total de la píldora en segundos', example: 90 })
  totalDurationSeconds: number;

  @ApiProperty({ description: 'Porcentaje de escucha completado (0 a 100)', example: 83.33 })
  percentage: number;

  @ApiProperty({ description: 'Indica si se alcanzó el umbral mínimo del 80% para desbloquear evaluación', example: true })
  isAudioCompleted: boolean;

  @ApiProperty({ description: 'Mensaje descriptivo del resultado del reporte', example: 'Audio completado exitosamente (umbral 80% alcanzado).' })
  message: string;
}
