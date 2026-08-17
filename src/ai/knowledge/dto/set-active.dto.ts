import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Activar o desactivar un documento (Sprint 5A, FR-022).
 *
 * Desactivar NO borra los vectores: viaja como metadata en ChromaDB y se filtra
 * en `search()`. Si borrara, reactivar obligaría a re-embeber el documento
 * entero — una llamada paga por apretar un interruptor.
 */
export class SetActiveDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  isActive!: boolean;
}
