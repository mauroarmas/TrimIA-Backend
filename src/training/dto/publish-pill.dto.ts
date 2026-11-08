import { IsBoolean, IsOptional } from 'class-validator';

export class PublishPillDto {
  @IsBoolean()
  @IsOptional()
  indexInKnowledge?: boolean;
}

