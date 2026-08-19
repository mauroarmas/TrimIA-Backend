import { Injectable } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Caller, CallerArea } from './caller.types';

/** Lo que necesita el resolver del empleado ya buscado por teléfono. */
export interface EmpleadoParaCaller {
  role: EmployeeRole;
  isActive: boolean;
  areasSupervisadas?: CallerArea[];
}

const CLIENTE: Caller = {
  userType: 'CLIENTE',
  role: null,
  areas: [],
  esGerente: false,
};

/**
 * Arma el `Caller` de un turno (spec 005).
 *
 * Recibe el empleado **ya resuelto por teléfono** —no lo busca— porque esa consulta
 * ya se hace en cada mensaje para decidir el `userType`, y hacerla dos veces sería
 * gratis para nadie.
 *
 * **Es el único lugar donde se decide si alguien es gerente.** Si ese cálculo
 * aparece repetido en un prompt o en un router, se rompió el punto único.
 */
@Injectable()
export class CallerResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(empleado: EmpleadoParaCaller | null): Promise<Caller> {
    // Fuera de la whitelist, o dado de baja: es un cliente. Mismo criterio que ya
    // usa el processor para el userType, y por eso la degradación de un empleado
    // desactivado sigue ocurriendo en el mismo turno.
    if (!empleado || !empleado.isActive) return CLIENTE;

    const areas = empleado.areasSupervisadas ?? [];

    // Gerente = responsable de TODAS las áreas que existen. Se cuenta en vez de
    // comparar contra un número fijo para que el día que exista un área nueva,
    // quien tenga las anteriores deje de ser gerente solo — que es lo correcto: ya
    // no es responsable de todo.
    //
    // Es un `count` sobre una tabla de cinco filas que además nunca cambia en
    // runtime (los sectores solo salen del seed), así que no se cachea: la
    // simplicidad vale más que ahorrar esto al lado de una llamada al LLM.
    const totalAreas = await this.prisma.sector.count();

    return {
      userType: 'EMPLEADO',
      role: empleado.role,
      areas,
      // `totalAreas > 0` no es paranoia: sin esa guarda, una base sin sectores
      // haría que 0 === 0 y **todos** serían gerentes.
      esGerente: totalAreas > 0 && areas.length === totalAreas,
    };
  }
}
