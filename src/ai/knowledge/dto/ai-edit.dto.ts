import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class AiEditPreviewDto {
  @ApiProperty({
    example:
      'el anticipo mínimo pasó de 20% a 30% y ahora también aplica a electrodomésticos',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000) // una instrucción de edición no es un documento
  instruction: string;
}

export class AiEditApplyDto {
  @ApiProperty({
    description:
      'Versión sobre la que se generó la propuesta. Si ya no es la vigente, ' +
      'la aplicación falla con 409 en vez de pisar el cambio de otro (FR-033).',
    example: 3,
  })
  @IsInt()
  @Min(1)
  baseVersion: number;

  @ApiProperty({
    description:
      'Texto final. Puede venir editado a mano después del preview: es ESTE ' +
      'texto el que se guarda, nunca uno regenerado por el modelo.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description:
      'La instrucción original. Queda en la bitácora para poder responder ' +
      'cuánto del corpus lo escribió una persona y cuánto lo propuso el modelo (FR-049).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  instruction: string;
}
