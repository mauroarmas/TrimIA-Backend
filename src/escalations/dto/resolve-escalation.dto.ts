import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResolveEscalationDto {
  @ApiProperty({ example: 'Sí, la tenemos en 12 cuotas sin interés.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    required: false,
    description: 'Si true, ingesta la respuesta al RAG como conocimiento reutilizable.',
  })
  @IsBoolean()
  @IsOptional()
  teachAgent?: boolean;
}
