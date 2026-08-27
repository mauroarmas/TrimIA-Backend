import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class MergePreviewDto {
  @ApiProperty({
    description:
      'Cuál de los dos documentos de la pareja va a sobrevivir. El otro queda ' +
      'absorbido (desactivado) al aprobar. Lo elige la persona, no el algoritmo.',
  })
  @IsUUID()
  @IsNotEmpty()
  keepDocumentId: string;
}
