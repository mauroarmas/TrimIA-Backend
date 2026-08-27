import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

export class MergeApplyDto {
  @ApiProperty({
    description: 'Igual al del preview: cuál de los dos documentos sobrevive.',
  })
  @IsUUID()
  @IsNotEmpty()
  keepDocumentId: string;

  @ApiProperty({
    description:
      'Versión del documento que sobrevive sobre la que se generó la propuesta. ' +
      'Si ya no es la vigente, la aplicación falla con 409 en vez de pisar el ' +
      'cambio de otro.',
    example: 3,
  })
  @IsInt()
  @Min(1)
  baseVersion: number;

  @ApiProperty({
    description:
      'Texto final fusionado. Puede venir editado a mano después del preview: ' +
      'es ESTE texto el que se guarda, nunca uno regenerado por el modelo.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;
}
