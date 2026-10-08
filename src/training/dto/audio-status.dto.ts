import { ApiProperty } from '@nestjs/swagger';
import { AudioStatus } from '@prisma/client';

export class AudioStatusResponseDto {
  @ApiProperty({ description: 'ID de la píldora formativa' })
  pillId: string;

  @ApiProperty({
    description: 'Estado del pipeline de audio',
    enum: AudioStatus,
    example: AudioStatus.AUDIO_READY,
  })
  status: AudioStatus;

  @ApiProperty({ description: 'Indica si ya existe un guion a 2 voces generado o editado' })
  hasScript: boolean;

  @ApiProperty({ description: 'Indica si el archivo de audio MP3 está listo para streaming' })
  hasAudio: boolean;

  @ApiProperty({ description: 'Duración total del audio en segundos', required: false, nullable: true })
  durationSeconds?: number | null;

  @ApiProperty({ description: 'Mensaje descriptivo del error si status es AUDIO_FAILED', required: false, nullable: true })
  error?: string | null;

  @ApiProperty({ description: 'URL relativa para reproducir el streaming de audio', required: false, nullable: true })
  streamUrl?: string | null;
}
