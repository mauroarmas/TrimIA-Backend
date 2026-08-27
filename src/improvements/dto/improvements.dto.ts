import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RefreshImprovementsDto {
  @ApiProperty({ description: 'El área a actualizar' })
  @IsUUID()
  sectorId!: string;
}

export class ListImprovementsQueryDto {
  @ApiProperty({ description: 'El área a mirar' })
  @IsUUID()
  sectorId!: string;
}

export class DismissImprovementDto {
  @ApiProperty({
    description:
      'El id del ítem, con su prefijo de fuente: `tema:` / `esc:` / `doc:`',
    example: 'doc:91a4e77e-0000-0000-0000-000000000000',
  })
  @IsString()
  @MaxLength(120)
  itemId!: string;

  @ApiPropertyOptional({ description: 'Por qué está bien así' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
