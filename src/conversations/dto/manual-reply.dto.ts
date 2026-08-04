import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ManualReplyDto {
  @ApiProperty({ example: 'Dale, te tomo el pedido yo directamente.' })
  @IsString()
  @IsNotEmpty()
  message: string;
}
