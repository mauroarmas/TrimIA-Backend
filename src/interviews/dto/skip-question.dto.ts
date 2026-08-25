import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SkipQuestionDto {
  @ApiProperty({ example: '…' })
  @IsUUID()
  questionId: string;
}
