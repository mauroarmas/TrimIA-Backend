import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListActivityQueryDto {
  @ApiPropertyOptional({ description: 'Solo actividad de un cliente puntual.' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    description:
      'Solo para Cobrador Controlador: ver los clientes de un cobrador puntual en vez de todos.',
  })
  @IsOptional()
  @IsUUID()
  collectorId?: string;

  @ApiPropertyOptional({
    description:
      'Filtra por tipo de evento (ej. quota_reminder_sent). Al pedirlo, la respuesta trae SOLO eventos: mensajes y notas no tienen este campo.',
  })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({ example: '2026-07-01T00:00:00Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  after?: Date;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
