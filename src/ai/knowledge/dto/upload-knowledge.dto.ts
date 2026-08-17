import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { AgentType, Audience } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Campos que acompañan al archivo en el multipart de `POST /knowledge/upload`.
 *
 * Ojo: en multipart TODO llega como string, incluso lo que en JSON sería otro
 * tipo. Por eso acá no hay ni números ni booleanos — el único booleano de este
 * endpoint (`force`) viaja como query param, donde ya hay un transform.
 */
export class UploadKnowledgeDto {
  @ApiProperty({ type: 'string', format: 'binary' })
  file?: unknown; // solo para que Swagger dibuje el selector de archivo

  @ApiPropertyOptional({
    description: 'Si se omite, se usa el nombre del archivo',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: 'politica' })
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiPropertyOptional({
    enum: Audience,
    description: 'Default INTERNO (lo más restrictivo)',
  })
  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;

  @ApiPropertyOptional({
    enum: AgentType,
    description: 'Omitir = documento general, visible para todos los agentes',
  })
  @IsOptional()
  @IsEnum(AgentType)
  agentType?: AgentType;
}
