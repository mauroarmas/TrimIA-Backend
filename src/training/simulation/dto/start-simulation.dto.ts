import { IsEnum, IsNotEmpty } from 'class-validator';
import { SimulationMode } from '@prisma/client';

export class StartSimulationDto {
  @IsEnum(SimulationMode, { message: 'El modo debe ser GUIDED o FREE' })
  @IsNotEmpty({ message: 'El modo de simulación es obligatorio' })
  mode: SimulationMode;
}
