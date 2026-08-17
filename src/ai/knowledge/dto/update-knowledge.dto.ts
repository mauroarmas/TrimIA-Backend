import { ApiProperty } from '@nestjs/swagger';
import { AgentType, Audience } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Edición de un documento de conocimiento (Sprint 5A, FR-020).
 *
 * Todos los campos son opcionales: se edita lo que se manda. La distinción que
 * importa es entre `content` y el resto — cambiar el contenido invalida los
 * vectores y dispara reindexación; cambiar el título, no. Ver
 * `KnowledgeService.update()`.
 */
export class UpdateKnowledgeDto {
  @ApiProperty({ required: false, example: 'Política de financiación 2026' })
  @IsString()
  @MinLength(1)
  @IsOptional()
  title?: string;

  @ApiProperty({
    required: false,
    description:
      'Cambiar esto versiona el documento y dispara la reindexación en ChromaDB.',
  })
  @IsString()
  @MinLength(1)
  @IsOptional()
  content?: string;

  @ApiProperty({ required: false, example: 'politica' })
  @IsString()
  @MinLength(1)
  @IsOptional()
  category?: string;

  @ApiProperty({ required: false, enum: Audience })
  @IsEnum(Audience)
  @IsOptional()
  audience?: Audience;

  @ApiProperty({
    required: false,
    enum: AgentType,
    description:
      'null / ausente = documento general, visible para todos los agentes.',
  })
  @IsEnum(AgentType)
  @IsOptional()
  agentType?: AgentType;
}
