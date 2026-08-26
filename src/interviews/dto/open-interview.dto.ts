import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class OpenInterviewDto {
  @ApiProperty({ example: '…' })
  @IsUUID()
  @IsString()
  sectorId: string;

  /**
   * Spec 011 (FR-005): entrevistarse sobre el ítem elegido en la lista, sin
   * pasar por una pantalla intermedia. Ese ítem va primero y el resto de la
   * lista del área detrás. Sin él, se comporta como hasta ahora.
   *
   * Es un campo nuevo en un endpoint que ya existe, no un endpoint nuevo: los
   * nueve de la entrevista siguen siendo nueve.
   */
  @ApiPropertyOptional({
    description: 'Id del ítem de la lista, con prefijo (`tema:`/`esc:`/`doc:`)',
    example: 'doc:91a4e77e-0000-0000-0000-000000000000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  itemId?: string;
}
