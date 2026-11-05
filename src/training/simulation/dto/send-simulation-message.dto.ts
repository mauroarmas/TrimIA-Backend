import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SendSimulationMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El contenido del mensaje debe ser un texto' })
  @IsNotEmpty({ message: 'El mensaje no puede estar vacío' })
  @MinLength(2, { message: 'El mensaje debe tener al menos 2 caracteres' })
  content: string;
}
