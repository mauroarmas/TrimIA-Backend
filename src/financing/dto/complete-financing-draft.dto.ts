import { Transform } from 'class-transformer';
import {
  IsInt,
  Min,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
export const positiveAmount =
  /^(?!0\.00$)(?:0\.[0-9]{2}|[1-9][0-9]*\.[0-9]{2})$/;
export class CompleteFinancingDraftDto {
  @IsInt() @Min(0) expectedVersion: number;
  @IsString() @Matches(positiveAmount) confirmedAmount: string;
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @Matches(/^\d{7,8}$/) dni?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  productSummary?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) sku?: string;
}
