import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class WebhookMessageDto {
  @ApiProperty({ example: '5491112345678' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'Hola, quiero consultar por un producto' })
  @IsString()
  @IsNotEmpty()
  message: string;
}