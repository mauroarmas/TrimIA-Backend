import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Channel } from '@prisma/client';

export class WebhookMessageDto {
  @ApiProperty({ example: '5491112345678' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'Hola, quiero consultar por un producto' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ enum: Channel, default: Channel.WHATSAPP, required: false })
  @IsEnum(Channel)
  @IsOptional()
  channel?: Channel;
}