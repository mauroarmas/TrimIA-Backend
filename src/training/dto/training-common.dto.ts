import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
} from 'class-validator';

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
  @ArrayMinSize(3)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  options: string[];

  @IsInt()
  @Min(0)
  correctOptionIndex: number;

  @IsString()
  @IsNotEmpty()
  explanation: string;
}
