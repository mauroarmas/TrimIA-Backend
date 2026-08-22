import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Áreas de las que una persona es responsable (spec 005, US3).
 *
 * **La lista reemplaza a la anterior**, no se le suma: mandar `[]` deja a la persona
 * sin ninguna área. Es lo que permite quitar una responsabilidad sin un endpoint
 * aparte para eso.
 *
 * **No hay campo de "gerente" y no es un olvido**: no existe tal cosa que setear.
 * Ser gerente es la consecuencia de tener todas las áreas, y ofrecer una casilla
 * haría creer que hay otro camino. Con `forbidNonWhitelisted` global, mandar el
 * campo devuelve 400 en vez de ignorarse en silencio.
 */
export class SetSupervisedAreasDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Ids de los sectores de los que es responsable. Reemplaza la lista anterior; ' +
      'con todos los sectores, la persona queda reconocida como gerente.',
    example: ['1a2b3c4d-...', '5e6f7a8b-...'],
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  sectorIds: string[];
}
