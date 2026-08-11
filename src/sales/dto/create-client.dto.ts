import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QuotaPlanItemDto {
  @ApiProperty({ description: 'Monto que corresponde pagar en esta cuota' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    description: 'Fecha de vencimiento (ISO)',
    example: '2026-09-10',
  })
  @IsDateString()
  dueDate: string;
}

export class CreateClientDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Teléfono de WhatsApp; se normaliza al guardar' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dni?: string;

  @ApiPropertyOptional({
    description:
      'Cobrador responsable. Puede omitirse: el cliente queda en la cola del Cobrador Controlador (FR-001b).',
  })
  @IsOptional()
  @IsString()
  assignedCollectorId?: string;

  @ApiProperty({
    type: [QuotaPlanItemDto],
    description: 'Plan de cuotas acordado en la venta',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotaPlanItemDto)
  quotas: QuotaPlanItemDto[];
}
