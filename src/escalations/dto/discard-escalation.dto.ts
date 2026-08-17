import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Descartar un caso escalado (FR-038).
 *
 * `reason` es opcional pero recomendado: es lo único que deja registro de por
 * qué alguien quedó sin respuesta. Sin él, el caso desaparece de la cola sin
 * que nadie pueda reconstruir la decisión después (OE-11).
 */
export class DiscardEscalationDto {
  @ApiProperty({
    required: false,
    example:
      'Consulta puntual de un solo cliente, no amerita respuesta estándar.',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}
