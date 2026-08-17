import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateInternalNoteDto {
  @ApiProperty({
    example: 'Cliente pidió que lo llamen, no sigue por WhatsApp.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;
}
