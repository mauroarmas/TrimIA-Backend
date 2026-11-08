import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class UpdateFollowUpRuleDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1)
  @Max(720)
  inactivityHours!: number;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
