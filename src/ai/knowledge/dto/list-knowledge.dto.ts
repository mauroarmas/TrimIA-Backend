import { ApiProperty } from '@nestjs/swagger';
import { AgentType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Filtros del listado de la Base de Conocimiento (Sprint 5A, FR-019).
 *
 * `agentType` es un filtro de NAVEGACIÓN (las pestañas por área de Fig 15), no
 * un permiso: cualquier supervisor consulta cualquier área (FR-045).
 */
export class ListKnowledgeQueryDto {
  @ApiProperty({
    required: false,
    enum: AgentType,
    description: 'Omitir para traer todas las áreas.',
  })
  @IsEnum(AgentType)
  @IsOptional()
  agentType?: AgentType;

  @ApiProperty({ required: false, example: 'politica' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiProperty({
    required: false,
    description: 'Omitir para traer activos e inactivos.',
  })
  // Llega como string en la query (?isActive=false); sin esto, "false" sería
  // truthy y el filtro haría lo contrario de lo que pide el supervisor.
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ required: false, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
