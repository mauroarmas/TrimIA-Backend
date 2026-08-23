import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * Pedido de propuesta para corregir un documento que quedó corto (spec 007, US1).
 *
 * Va como **body de un POST** y no como query de un GET, aunque no persista
 * nada: lleva el texto completo de la respuesta, dispara una llamada a Gemini
 * —que cuesta y tarda— y no es cacheable. Es la misma decisión que ya tomó
 * `POST /knowledge/:id/ai-edit/preview`, que tampoco escribe y también es POST.
 */
export class CorrectionPreviewDto {
  @ApiProperty({
    description:
      'Documento a corregir. Tiene que ser uno de los que devuelve ' +
      'GET /supervisor/escalations/:id/knowledge-candidates.',
  })
  @IsUUID()
  documentId: string;

  @ApiProperty({
    example: 'Credimisión vende electrodomésticos con financiación propia.',
    description:
      'La respuesta que el supervisor ya escribió para el caso. Se manda acá ' +
      'para no pedirle el mismo texto dos veces: de ella sale la instrucción ' +
      'con la que se arma la propuesta.',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}
