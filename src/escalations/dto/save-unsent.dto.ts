import { ApiProperty } from '@nestjs/swagger';
import { AgentType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * "Aprobar y guardar sin enviar" (FR-039).
 *
 * A diferencia de `ResolveEscalationDto`, acá `title` y `category` son
 * obligatorios y no condicionales: incorporar la respuesta al conocimiento no
 * es una opción de esta acción, es la acción entera. Un `saveUnsent` sin
 * ingesta sería indistinguible de un `discard`.
 *
 * **No lleva `audience`**: se deriva del `userType` de la conversación
 * escalada, no la elige quien guarda (research §12).
 */
export class SaveUnsentDto {
  @ApiProperty({
    example:
      'Para dar de baja un plan de financiación hay que pedirlo por escrito…',
    description: 'Texto aprobado por el supervisor. NO se le envía al usuario.',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ example: 'Baja de un plan de financiación' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'procedimientos' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({
    required: false,
    enum: AgentType,
    description: 'Por defecto se usa el agente activo de la conversación.',
  })
  @IsEnum(AgentType)
  @IsOptional()
  agentType?: AgentType;
}
