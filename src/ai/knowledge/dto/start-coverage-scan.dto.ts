import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/** Body de `POST /knowledge/coverage/scan`. Los dos campos son opcionales
 * (FR-014): sin ellos, la corrida usa `COVERAGE_WINDOW_DAYS` hasta ahora. */
export class StartCoverageScanDto {
  @ApiProperty({ required: false, example: '2026-07-24T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  windowFrom?: string;

  @ApiProperty({ required: false, example: '2026-08-23T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  windowTo?: string;
}
