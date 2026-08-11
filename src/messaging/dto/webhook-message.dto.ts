import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Channel } from '@prisma/client';
import { normalizePhone } from '../../common/phone';

export class WebhookMessageDto {
  // Se normaliza acá, en el borde: es lo que termina en
  // Conversation.externalId y lo que se cruza contra Employee.phone y
  // Client.phone. Un solo punto de entrada = un solo formato en la base.
  @ApiProperty({ example: '5491112345678' })
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @IsNotEmpty()
  phone: string;

  // Opcional: un mensaje con imagen puede llegar con caption vacío.
  // 4096: límite de WhatsApp para un mensaje de texto, así que nunca llega
  // legítimamente algo más largo — evita mandar texto arbitrariamente largo
  // al prompt del LLM (costo) o a los regex de isTrivial (backtracking).
  @ApiProperty({ example: 'Hola, quiero consultar por un producto', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(4096)
  message?: string;

  @ApiProperty({ enum: Channel, default: Channel.WHATSAPP, required: false })
  @IsEnum(Channel)
  @IsOptional()
  channel?: Channel;

  // Comprobante de pago (Sprint 4): n8n resuelve y descarga el media de Meta
  // (tiene el token; el backend no) y lo reenvía en base64 — ver
  // specs/002-collections-payments/research.md §1.
  @ApiProperty({ required: false, description: 'Imagen en base64 (comprobante de pago)' })
  @IsString()
  @IsOptional()
  mediaBase64?: string;

  @ApiProperty({ required: false, example: 'image/jpeg' })
  @ValidateIf((o) => !!o.mediaBase64)
  @IsString()
  @IsNotEmpty()
  mimeType?: string;
}