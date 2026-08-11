import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';

/**
 * Bloquea las rutas /dev/* fuera de desarrollo. 404 (no 403) para no revelar
 * en producción que la ruta existe.
 *
 * Fail-closed: exige NODE_ENV === 'development' explícito, en vez de excluir
 * solo 'production'. NODE_ENV tiene default 'development' en la validación
 * de Joi (config.module.ts) — si un despliegue se olvida de setearlo, la
 * versión anterior (excluir solo 'production') dejaba esto abierto por el
 * default equivocado. /dev/client-fixtures puede desactivar cualquier
 * Employee por teléfono, así que abierto en prod es explotable.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (process.env.NODE_ENV !== 'development') {
      throw new NotFoundException();
    }
    return true;
  }
}