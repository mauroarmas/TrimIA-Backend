import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class StockQueryDto {
  @ApiPropertyOptional({ description: 'Término de búsqueda o modelo', example: 'cortadora' })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ description: 'Categoría de producto', example: 'CORTADORAS' })
  @IsOptional()
  @IsString()
  category?: string;
}

