import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ProofRejectionReason } from '@prisma/client';

export class RejectProofDto {
  @ApiProperty({ enum: ProofRejectionReason })
  @IsEnum(ProofRejectionReason)
  reason: ProofRejectionReason;
}
