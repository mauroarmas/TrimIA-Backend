import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DelegateEscalationDto {
  @ApiProperty({ description: 'Id del empleado (SUPERVISOR) al que se delega el caso.' })
  @IsString()
  @IsNotEmpty()
  toEmployeeId: string;
}
