import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class CreateFinancingPlanDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsInt() @Min(1) @Max(260) quotaCount: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) firstDueDate: string;
  @IsUUID() collectorId: string;
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
}
