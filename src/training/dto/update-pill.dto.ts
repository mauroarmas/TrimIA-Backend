import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VerificationQuestionDto } from './training-common.dto';

export class UpdatePillDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  objective?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VerificationQuestionDto)
  @IsOptional()
  quiz?: VerificationQuestionDto[];

  @IsInt()
  @IsOptional()
  orderIndex?: number;
}

