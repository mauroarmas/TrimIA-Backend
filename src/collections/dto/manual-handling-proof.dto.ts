import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ManualHandlingProofDto {
  @ApiProperty({
    required: false,
    example: 'Cliente prefiere coordinar por teléfono.',
  })
  @IsString()
  @IsOptional()
  note?: string;
}
