import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizePhone } from '../../common/phone';

/**
 * `POST /messaging/simulate` — Simulador de Chat del panel (spec 004, US3).
 *
 * Lo que NO tiene es tan importante como lo que tiene: **no hay `channel`, no hay
 * `userType` y no hay `role`**.
 *
 * - Sin `channel`, porque el endpoint fuerza `WEB`. Si se pudiera elegir
 *   `WHATSAPP`, escribir un teléfono cualquiera en el simulador le mandaría un
 *   WhatsApp real a un desconocido: el corte que evita el envío existe solo para
 *   canales distintos de WhatsApp. Un banco de pruebas no puede tener una forma
 *   accidental de escribirle a un tercero.
 * - Sin `userType` ni `role`, porque quién es el remitente **no se declara, se
 *   resuelve**: lo decide la presencia del teléfono en la tabla `Employee`, que ES
 *   la whitelist. El simulador elige el teléfono, no el rol (RF-018, RN-3).
 *
 * Como el `ValidationPipe` global corre con `forbidNonWhitelisted`, mandar
 * cualquiera de esos campos no se ignora: se rechaza con 400.
 */
export class SimulateMessageDto {
  // Se normaliza en el borde, igual que WebhookMessageDto: es lo que termina en
  // Conversation.externalId y lo que se cruza contra Employee.phone.
  @ApiProperty({
    example: '5493764000000',
    description:
      'Teléfono desde el que se simula. Puede no existir en la whitelist.',
  })
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'Hola, quiero consultar por un producto' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096) // mismo tope que los otros dos DTOs de mensajería
  message: string;
}
