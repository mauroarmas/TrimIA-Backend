import {
  IsInt,
  Min,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReviewFinancingDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
