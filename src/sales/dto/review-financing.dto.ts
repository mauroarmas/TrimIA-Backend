import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewFinancingDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
