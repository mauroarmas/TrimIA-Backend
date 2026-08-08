import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignCollectorDto {
  @ApiProperty({
    description: 'Id del empleado (cobrador) que queda a cargo del cliente',
  })
  @IsString()
  @IsNotEmpty()
  collectorId: string;
}
