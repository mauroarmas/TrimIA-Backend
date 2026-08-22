import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * `POST /messaging/web/:convId/delegate` (spec 005, US4, FR-010).
 *
 * Lo único que viaja es **a quién** se le pasa la consulta. El texto de la consulta
 * NO va en el body: sale de la conversación, del último mensaje del usuario. Si
 * viniera de acá, el caso podría llegarle a otra persona con un texto distinto del
 * que realmente se preguntó.
 */
export class DelegateFromChatDto {
  @ApiProperty({
    description:
      'Empleado que recibe el caso. Tiene que ser un SUPERVISOR activo.',
  })
  @IsUUID()
  toEmployeeId: string;
}
