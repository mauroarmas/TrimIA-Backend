import { IsArray, IsInt, IsNotEmpty, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export interface VerificationQuestion {
  id: number;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
}

export class VerificationQuestionDto implements VerificationQuestion {
  @IsInt()
  id: number;

  @IsString()
  @IsNotEmpty()
  question: string;

  @IsArray()
  @IsString({ each: true })
  options: string[];

  @IsInt()
  @Min(0)
  correctOptionIndex: number;

  @IsString()
  @IsNotEmpty()
  explanation: string;
}

