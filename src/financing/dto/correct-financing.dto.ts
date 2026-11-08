import {
  Equals,
  IsInt,
  Min,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { positiveAmount } from './complete-financing-draft.dto';
export class CorrectFinancingDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsString() @Matches(/^\d{7,8}$/) dni: string;
  @IsString() @MinLength(1) @MaxLength(500) productSummary: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) sku?: string;
  @IsString() @Matches(positiveAmount) amount: string;
  @Equals(true) confirmData: boolean;
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
}
