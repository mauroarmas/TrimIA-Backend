import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GeneratePillDto {
  @IsString()
  @IsNotEmpty()
  moduleId: string;

  @IsString()
  @IsNotEmpty()
  topic: string;

  @IsString()
  @IsOptional()
  additionalNotes?: string;
}

