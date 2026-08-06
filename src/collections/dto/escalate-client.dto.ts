import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class EscalateClientDto {
  @ApiProperty({ example: 'El cliente no respondió a 3 recordatorios, pide hablar con un responsable.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}