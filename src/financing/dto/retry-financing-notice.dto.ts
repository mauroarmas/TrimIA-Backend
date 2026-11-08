import { IsInt, Min } from 'class-validator';
export class RetryFinancingNoticeDto {
  @IsInt() @Min(1) expectedVersion: number;
}
