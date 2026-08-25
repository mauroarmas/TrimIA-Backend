import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MinLength } from 'class-validator';

export class AnswerQuestionDto {
  @ApiProperty({ example: '…' })
  @IsUUID()
  questionId: string;

  @ApiProperty({ example: 'A Posadas llega en 48 horas.' })
  @IsString()
  @MinLength(1)
  text: string;
}
