import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaymentModality } from '@prisma/client';

export class CloseSaleDto {
  @ApiPropertyOptional({ description: 'ID del prospecto en CRM', example: 'uuid-prospect' })
  @IsOptional()
  @IsString()
  prospectId?: string;

  @ApiPropertyOptional({ description: 'ID de la ficha de compra (PurchaseRequest)', example: 'uuid-purchase-request' })
  @IsOptional()
  @IsString()
  purchaseRequestId?: string;

  @ApiProperty({ description: 'Monto final acordado en la venta', example: 350000 })
  @IsNotEmpty()
  @IsNumber()
  finalAmount!: number;

  @ApiProperty({ enum: PaymentModality, example: PaymentModality.CASH })
  @IsNotEmpty()
  @IsEnum(PaymentModality)
  modality!: PaymentModality;

  @ApiProperty({
    description: 'Notas del vendedor o número de comprobante emitido manualmente en Paljet',
    example: 'Factura A-0001-00004523 emitida en Paljet.',
  })
  @IsNotEmpty()
  @IsString()
  notes!: string;
}

