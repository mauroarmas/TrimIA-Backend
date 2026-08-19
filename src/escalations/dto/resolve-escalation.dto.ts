import { ApiProperty } from '@nestjs/swagger';
import { AgentType, Audience } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class ResolveEscalationDto {
  @ApiProperty({ example: 'Sí, la tenemos en 12 cuotas sin interés.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    required: false,
    description:
      'Si true, ingesta la respuesta al RAG como conocimiento reutilizable.',
  })
  @IsBoolean()
  @IsOptional()
  teachAgent?: boolean;

  @ApiProperty({
    required: false,
    example: 'Financiación de heladeras exhibidoras en cuotas',
    description:
      'Título del documento de conocimiento (igual que en POST /knowledge). Requerido si teachAgent=true.',
  })
  @ValidateIf((o: ResolveEscalationDto) => o.teachAgent === true)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiProperty({
    required: false,
    example: 'productos',
    description:
      'Categoría del documento de conocimiento (igual que en POST /knowledge). Requerida si teachAgent=true.',
  })
  @ValidateIf((o: ResolveEscalationDto) => o.teachAgent === true)
  @IsString()
  @IsNotEmpty()
  category?: string;

  @ApiProperty({
    required: false,
    enum: Audience,
    description:
      'Por defecto INTERNO (el más restrictivo), sin importar el tipo de ' +
      'usuario de la conversación: para que quede disponible como respuesta ' +
      'a cualquier cliente hay que pedirlo a propósito con PUBLICO.',
  })
  @IsEnum(Audience)
  @IsOptional()
  audience?: Audience;

  @ApiProperty({
    required: false,
    enum: AgentType,
    description: 'Por defecto se usa el agente activo de la conversación.',
  })
  @IsEnum(AgentType)
  @IsOptional()
  agentType?: AgentType;
}
