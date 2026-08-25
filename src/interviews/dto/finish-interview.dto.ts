import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class FinishInterviewDto {
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  confirmPending?: boolean;
}
