import { IsOptional, IsString } from 'class-validator';

export class ConcludeSimulationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
