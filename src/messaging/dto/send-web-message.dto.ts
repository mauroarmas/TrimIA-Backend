import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /messaging/web` (US4). El teléfono NO viaja en el body a propósito:
 * sale del empleado autenticado por el token. Mandarlo sería una vía para
 * suplantar a otro usuario (research §8).
 */
export class SendWebMessageDto {
  @ApiProperty({
    example: '¿Cuál es el procedimiento para dar de baja un plan?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096) // mismo tope que WebhookMessageDto: sin motivo para que el web permita más
  message: string;
}
