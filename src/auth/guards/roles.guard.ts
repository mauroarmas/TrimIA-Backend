import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

/**
 * Decorador @Roles('SUPERVISOR') — restringe acceso por rol.
 */
export const Roles =
  (...roles: string[]) =>
  (target: any, key?: string | symbol, descriptor?: any) => {
    Reflect.defineMetadata(ROLES_KEY, roles, descriptor?.value ?? target);
    return descriptor ?? target;
  };

/**
 * Guard que verifica si el usuario tiene alguno de los roles requeridos.
 * Debe usarse DESPUÉS de JwtAuthGuard (para que req.user exista).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Si no hay @Roles(), acceso libre (para empleados autenticados).
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        'No tenés permisos para acceder a este recurso',
      );
    }

    return true;
  }
}
