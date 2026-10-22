import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { CreditVerdict } from '@prisma/client';

export class CreditCheckDto {
  @ApiProperty({ description: 'DNI o CUIT del cliente a verificar', example: '32123458' })
  @IsNotEmpty()
  @IsString()
  dni!: string;

  @ApiPropertyOptional({ description: 'Monto estimado pretendido en cuotas', example: 250000 })
  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class CommercialCreditResultDto {
  @ApiProperty({ enum: CreditVerdict, example: CreditVerdict.APPROVED })
  verdict!: CreditVerdict;

  @ApiProperty({
    description: 'Condición comercial comprensible para el vendedor y cliente (sin datos bancarios confidenciales)',
    example: 'Aprobado para financiación hasta 24 cuotas semanales sin anticipo.',
  })
  commercialCondition!: string;

  @ApiProperty({ example: '2026-10-21T15:30:00.000Z' })
  evaluatedAt!: Date;
}

