import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkThemeHandledDto {
  @ApiProperty({
    required: false,
    maxLength: 500,
    example: 'corregí Sobre Nosotros',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}
