import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { Channel } from '@prisma/client';

export class WebhookMessageDto {
  @ApiProperty({ example: '5491112345678' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  // Opcional: un mensaje con imagen puede llegar con caption vacío.
  @ApiProperty({ example: 'Hola, quiero consultar por un producto', required: false })
  @IsString()
  @IsOptional()
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