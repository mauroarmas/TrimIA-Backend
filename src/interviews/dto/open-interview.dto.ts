import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class OpenInterviewDto {
  @ApiProperty({ example: '…' })
  @IsUUID()
  @IsString()
  sectorId: string;
}
