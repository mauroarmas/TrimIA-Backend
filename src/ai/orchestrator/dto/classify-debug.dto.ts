import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ClassifyDebugDto {
  @ApiProperty({ example: 'todavía no me llegó lo que compré' })
  @IsString()
  @IsNotEmpty()
  message: string;
}
