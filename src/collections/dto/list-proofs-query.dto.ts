import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaymentProofStatus } from '@prisma/client';

export class ListProofsQueryDto {
  @ApiPropertyOptional({
    enum: PaymentProofStatus,
    description:
      'Sin especificar, devuelve PENDING_REVIEW (comportamiento original).',
  })
  @IsOptional()
  @IsEnum(PaymentProofStatus)
  status?: PaymentProofStatus;
}
