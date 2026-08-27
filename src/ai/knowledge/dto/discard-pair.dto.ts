import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DiscardPairDto {
  @ApiProperty({
    required: false,
    maxLength: 500,
    example:
      'Uno es la política general y el otro el caso puntual del cliente que reclama.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
