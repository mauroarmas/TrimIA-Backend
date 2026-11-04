import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export class VerifyQuizDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsInt({ each: true })
  @Min(0, { each: true })
  answers: number[];
}

export interface QuizVerificationResult {
  passed: boolean;
  failedIndices: number[];
  explanations: string[];
  nextPillId?: string | null;
}
