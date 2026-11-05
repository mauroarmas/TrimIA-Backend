import { IsInt, Min, IsOptional, IsString, MaxLength } from 'class-validator';
export class CancelFinancingDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
