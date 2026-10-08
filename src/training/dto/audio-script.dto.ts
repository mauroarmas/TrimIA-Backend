import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export enum SpeakerRole {
  SPEAKER_1 = 'SPEAKER_1',
  SPEAKER_2 = 'SPEAKER_2',
}

export class DialogueLineDto {
  @ApiProperty({
    description: 'Rol del locutor (SPEAKER_1: Conductor/a, SPEAKER_2: Copresentador/a)',
    enum: SpeakerRole,
    example: SpeakerRole.SPEAKER_1,
  })
  @IsEnum(SpeakerRole)
  speaker: SpeakerRole;

  @ApiProperty({
    description: 'Texto del diálogo con modismos rioplatenses naturales',
    example: '¡Hola a todos! Bienvenidos a una nueva píldora de capacitación.',
  })
  @IsString()
  @IsNotEmpty()
  text: string;
}

export class AudioScriptDto {
  @ApiProperty({
    description: 'Título del guion de audio',
    example: 'Gestión de Cobranzas Tempranas - Guion a 2 Voces',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Duración estimada del audio en segundos',
    example: 90,
  })
  @IsInt()
  @Min(1)
  estimatedDurationSeconds: number;

  @ApiProperty({
    description: 'Líneas estructuradas de diálogo entre los dos locutores',
    type: [DialogueLineDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DialogueLineDto)
  dialogue: DialogueLineDto[];
}

export class UpdateAudioScriptDto {
  @ApiProperty({
    description: 'Título del guion de audio (opcional para edición)',
    example: 'Gestión de Cobranzas Tempranas - Guion Editado',
    required: false,
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Duración estimada en segundos (opcional para recálculo)',
    example: 105,
    required: false,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  estimatedDurationSeconds?: number;

  @ApiProperty({
    description: 'Líneas estructuradas de diálogo a actualizar',
    type: [DialogueLineDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DialogueLineDto)
  dialogue: DialogueLineDto[];
}
