import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class VerifyQuizDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsInt({ each: true })
  answers: number[];
}

export interface QuizVerificationResult {
  passed: boolean;
  failedIndices: number[];
  explanations: string[];
  nextPillId?: string | null;
}
